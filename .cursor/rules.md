# 🧠 CURSOR INSTRUCTIONS (FOR A.R.I.S.)

## 🔧 CORE DIRECTIVE

You are building a **deterministic, correctness-first graph-based code intelligence system (A.R.I.S.) in Rust**.

Your job is NOT to:
* suggest shortcuts
* simplify architecture
* replace structures with naive alternatives

Your job IS to:
* preserve invariants
* prevent silent corruption
* enforce system constraints

---

## ⚠️ NON-NEGOTIABLE RULES

### 1. NO RAW STRINGS IN CORE SYSTEM
* All strings MUST go through the interner
* Use `StringId` everywhere
* Never store `String` in graph or events

### 2. GRAPH INTEGRITY > PERFORMANCE
Always ensure:
* no duplicate edges
* no dangling edges
* bidirectional consistency (adj_out ↔ adj_in)

Never suggest:
* skipping validation
* partial updates

### 3. EDGE TYPES ARE MANDATORY
All edges MUST include `EdgeType`. Reject untyped edges or `(NodeId, NodeId)` without semantics.

### 4. NO O(N) TRAPS IN HOT PATHS
Enforce `HashSet` for deduplication. Disallow linear scans in edge insertion or `.contains()` on Vec in graph operations.

### 5. NO DIRECT GRAPH MUTATION FROM PARSER
Parser → emits events ONLY. Event pipeline → mutates graph.

### 6. BATCH PROCESSING ONLY
All updates must go through debounce + batch. No per-keystroke updates.

### 7. MEMORY MUST BE DEDUPLICATED
Use `Rc<str>` or `Arc<str>`. Reject double allocation or `.clone()` on String for storage.

### 8. BOUNDED TRAVERSAL ONLY
Hard limits: depth ≤ 4, nodes ≤ 150. Reject unbounded BFS/DFS.

### 9. SUPERNODE HANDLING
Must detect using in/out degree (threshold > 300). Must NOT expand supernodes, but STILL include them in result.

### 10. NO BLOCKING LOOPS
Use `tokio::select!` and async event handling. Reject busy waits.

---

## 🧱 ARCHITECTURE CONSTRAINTS

| Layer | Responsibility                  |
| ----- | ------------------------------- |
| 1     | Interner + IDs                  |
| 2     | Graph (pure, deterministic)     |
| 3     | Parser → emits events           |
| 4     | Event pipeline (async, batched) |
| 5     | Traversal (bounded)             |
| 6     | Context builder                 |
| 7     | Orchestrator                    |
| 8     | Workers                         |

## 🧪 TESTING RULES
Every core function MUST include correctness test, edge case test, and stress test.

## 🚫 ANTI-PATTERNS (AUTO-REJECT)
* Using `String` instead of `StringId`
* Using `Vec` for deduplication
* Dropping `EdgeType`
* Direct parser → graph mutation
* Blocking async runtime
* Ignoring deletion consistency
* Splitting context blindly by text
* Using global mutable state (unsafe static)

## 🧭 WHEN UNSURE
Default to stricter validation, safer memory model, explicit structure over magic.

> If a suggestion weakens system guarantees, explicitly warn and provide a safer alternative.
