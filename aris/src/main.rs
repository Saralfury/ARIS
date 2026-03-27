pub mod types;
pub mod interner;
pub mod graph;
pub mod parser;
pub mod events;
pub mod traversal;
pub mod context;
pub mod orchestrator;
pub mod network;
pub mod chaos_test;
pub mod llm;
pub mod github;

use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;
use tokio::sync::{mpsc, RwLock};
use std::sync::Arc;
use crate::events::{Event, GraphState, run_event_pipeline};
use crate::interner::Interner;
use crate::traversal::extract_bounded_subgraph;
use crate::context::ContextBuilder;
use crate::github::fetch_github_graph;

/// Selects 3 start nodes using different strategies:
/// 1. Highest In-Degree
/// 2. Highest Out-Degree
/// 3. A "Random Central" node (random node from top 20% by degree)
fn select_start_nodes(graph: &crate::graph::Graph) -> Vec<crate::types::NodeId> {
    let mut nodes: Vec<crate::types::NodeId> = graph.adj_out.keys().copied().collect();
    if nodes.is_empty() { return vec![]; }

    let mut starts = Vec::new();

    // 1. Highest In-Degree
    if let Some(&id) = nodes.iter().max_by_key(|&&id| graph.in_degree.get(&id).unwrap_or(&0)) {
        starts.push(id);
    }

    // 2. Highest Out-Degree
    if let Some(&id) = nodes.iter().max_by_key(|&&id| graph.out_degree.get(&id).unwrap_or(&0)) {
        if !starts.contains(&id) { starts.push(id); }
    }

    // 3. Random Central (Random node from top 20% by degree)
    nodes.sort_by_key(|&id| std::cmp::Reverse(
        graph.in_degree.get(&id).unwrap_or(&0) + graph.out_degree.get(&id).unwrap_or(&0)
    ));
    
    let top_count = (nodes.len() as f32 * 0.2).max(1.0) as usize;
    let top_nodes = &nodes[..top_count.min(nodes.len())];
    
    use rand::seq::SliceRandom;
    let mut rng = rand::thread_rng();
    if let Some(&id) = top_nodes.choose(&mut rng) {
        if !starts.contains(&id) { starts.push(id); }
    }

    starts
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    println!("A.R.I.S. Deterministic Graph Code Intelligence System is Active.");

    let shared_state = Arc::new(RwLock::new(GraphState::new()));
    let interner = Arc::new(RwLock::new(Interner::new()));
    let (_event_tx, event_rx) = mpsc::channel::<Event>(100_000);

    let pipeline_state = shared_state.clone();
    tokio::spawn(async move {
        run_event_pipeline(event_rx, pipeline_state).await;
    });

    let listener = TcpListener::bind("127.0.0.1:9001").await.expect("Failed to bind port 9001");
    println!("ARIS backend listening on ws://127.0.0.1:9001");

    while let Ok((stream, _addr)) = listener.accept().await {
        let state_clone = shared_state.clone();
        let interner_clone = interner.clone();

        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => return,
            };

            let (mut write, mut read) = ws_stream.split();

            while let Some(msg) = read.next().await {
                let text = match msg {
                    Ok(Message::Text(t)) => t,
                    _ => break,
                };

                let parsed: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let msg_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");

                if msg_type == "load_repo" {
                    let owner = parsed.get("owner").and_then(|t| t.as_str()).unwrap_or("demo").to_string();
                    let repo = parsed.get("repo").and_then(|t| t.as_str()).unwrap_or("aris").to_string();

                    let cache_file = format!("{}_{}_cache.json", owner, repo);
                    let mut loaded_from_cache = false;
                    let mut payload: Option<crate::types::GraphPayload> = None;

                    // 1. Check Offline Cache
                    if std::path::Path::new(&cache_file).exists() {
                        print!("[CACHE] Found local cache: {} — ", cache_file);
                        if let Ok(json_str) = std::fs::read_to_string(&cache_file) {
                            if let Ok(p) = serde_json::from_str::<crate::types::GraphPayload>(&json_str) {
                                payload = Some(p);
                                loaded_from_cache = true;
                                println!("SUCCESS");
                            } else {
                                println!("CORRUPT (falling back to fetch)");
                            }
                        } else {
                            println!("READ ERROR (falling back to fetch)");
                        }
                    }

                    let mut gs = state_clone.write().await;
                    let mut int = interner_clone.write().await;
                    
                    // Reset if requested
                    gs.graph = crate::graph::Graph::new();
                    *int = Interner::new();

                    if !loaded_from_cache {
                        println!("[FETCH] Requesting {}/{} from GitHub API...", owner, repo);
                        
                        // Use a channel or similar to send progress back from the callback
                        // But since we are in a single block, we can just use the 'write' sink directly if we wrap it.
                        // For simplicity, we'll just fetch and then send progress as logs.
                        
                        // BUT let's try to send real progress to WebSocket
                        let result = fetch_github_graph(&owner, &repo, &mut *int, &mut gs.graph, |_curr, _tot| {
                            // Progress event (sent but not awaited here, might be tricky with Send + Sync)
                            // We will skip progress for now or just log to server
                        }).await;

                        match result {
                            Ok(p) => {
                                // Save to Cache
                                if let Ok(json_pretty) = serde_json::to_string_pretty(&p) {
                                    if let Err(e) = std::fs::write(&cache_file, json_pretty) {
                                        eprintln!("[CACHE] Write error: {}", e);
                                    }
                                }
                                payload = Some(p);
                            }
                            Err(e) => {
                                let _ = write.send(Message::Text(json!({ "type": "error", "message": e }).to_string())).await;
                            }
                        }
                    } else {
                        // Re-build the in-memory graph from payload to support queries later
                        if let Some(p) = &payload {
                            for n in &p.nodes {
                                let id = int.intern(&n.label);
                                gs.graph.add_node(id);
                            }
                            for e in &p.edges {
                                let src_label = p.nodes.iter().find(|n| n.id == e.source).map(|n| n.label.as_str());
                                let dst_label = p.nodes.iter().find(|n| n.id == e.target).map(|n| n.label.as_str());
                                if let (Some(src_l), Some(dst_l)) = (src_label, dst_label) {
                                    let src = int.intern(src_l);
                                    let dst = int.intern(dst_l);
                                    gs.graph.add_edge(src, dst, crate::types::EdgeType::Imports);
                                }
                            }
                        }
                    }

                    // Send final graph to frontend
                    if let Some(p) = payload {
                        let resp = json!({
                            "type": "graph",
                            "nodes": p.nodes,
                            "edges": p.edges,
                        }).to_string();
                        let _ = write.send(Message::Text(resp)).await;
                    }
                }
 else if msg_type == "query" {
                    let question = parsed.get("question").and_then(|q| q.as_str()).unwrap_or("");
                    let gs = state_clone.read().await;
                    let int = interner_clone.read().await;

                    if gs.graph.adj_out.is_empty() && gs.graph.in_degree.is_empty() {
                        let _ = write.send(Message::Text(json!({ "type": "error", "message": "No graph loaded" }).to_string())).await;
                        continue;
                    }

                    // Multi-strategy start selection
                    let starts = select_start_nodes(&gs.graph);
                    
                    // Merge traversal results
                    let mut merged_nodes = std::collections::HashSet::new();
                    let mut merged_edges = Vec::new();
                    
                    for start_id in starts {
                        let subgraph = extract_bounded_subgraph(&gs.graph, start_id);
                        merged_nodes.extend(subgraph.nodes);
                        merged_edges.extend(subgraph.edges);
                    }
                    
                    // Deduplicate edges
                    merged_edges.sort();
                    merged_edges.dedup();

                    let merged_subgraph = crate::traversal::Subgraph {
                        nodes: merged_nodes,
                        edges: merged_edges,
                    };

                    let context = ContextBuilder::new(&*int, 8000).build(&gs.graph, &merged_subgraph);
                    
                    match crate::llm::query_llm(&context, question).await {
                        Ok(answer) => {
                            let highlighted: Vec<u32> = merged_subgraph.nodes.iter().copied().collect();
                            
                            // 1. Calculate degrees into a properly typed intermediate vector
                            let mut node_degrees: Vec<(u32, usize)> = merged_subgraph.nodes.iter()
                                .map(|&id| {
                                    let in_deg = *gs.graph.in_degree.get(&id).unwrap_or(&0);
                                    let out_deg = *gs.graph.out_degree.get(&id).unwrap_or(&0);
                                    (id, in_deg + out_deg)
                                })
                                .collect();

                            // 2. Sort by highest degree
                            node_degrees.sort_by_key(|&(_, deg)| std::cmp::Reverse(deg));

                            // 3. Extract the top 3 as Strings
                            let top_file_names: Vec<String> = node_degrees.into_iter()
                                .filter_map(|(id, _)| int.resolve(id).map(|s| s.to_string()))
                                .take(3)
                                .collect();

                            let resp = json!({
                                "type": "answer",
                                "answer": answer,
                                "highlighted_nodes": highlighted,
                                "top_files": top_file_names,
                            }).to_string();
                            let _ = write.send(Message::Text(resp)).await;
                        }
                        Err(e) => {
                            let _ = write.send(Message::Text(json!({ "type": "error", "message": e }).to_string())).await;
                        }
                    }
                }
            }
        });
    }
}
