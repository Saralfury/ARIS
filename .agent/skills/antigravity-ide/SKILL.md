---
name: enforcing-structured-workflows
description: Provides structured development workflows inside the Antigravity IDE by enforcing spec-first design, task decomposition, and controlled execution. Use when the user starts building a feature, implementing code, or requesting major refactoring.
---

# antigravity-ide

## Purpose

Provide structured development workflows inside the Antigravity IDE by enforcing spec-first design, task decomposition, and controlled execution. This skill ensures that coding is guided by clear intent, not impulsive implementation.

## When to Use

Activate when:
* User starts building a feature or project in Antigravity IDE
* User asks to “build”, “implement”, “add feature”
* Codebase changes are required
* Refactoring or debugging is requested

Do NOT use when:
* Query is purely informational
* No implementation is required
* Task is trivial (single-line fix)

## Workflow

### 1. Intent Extraction
* Pause before coding
* Ask: What is the actual goal?
* Convert vague ideas into a clear specification

### 2. Spec Generation
* Break feature into:
  * Inputs
  * Outputs
  * Constraints
  * Edge cases
* Present spec in small chunks for validation

### 3. Plan Construction
* Decompose into atomic tasks (2–5 min each)
* Each task must include:
  * File path
  * Exact change
  * Expected outcome
  * Verification step

### 4. Execution Strategy
Choose one:
**A. Sequential Execution**
* Step-by-step implementation
* Validate after each step

**B. Subagent Execution**
* Assign isolated tasks to subagents
* Review output in two stages:
  * Spec compliance
  * Code quality

### 5. Code Standards
* Minimal, readable code
* No premature optimization
* DRY and modular structure
* Avoid unnecessary abstractions

### 6. Verification
* Ensure feature works as specified
* Run tests or simulate behavior
* Validate edge cases

### 7. Completion Protocol
* Confirm:
  * All tasks completed
  * No broken dependencies
  * Code matches spec
* Provide next actions:
  * Merge
  * Extend
  * Refactor

## Output Requirements
* Clear specification
* Structured plan
* Clean implementation
* Verified result

## Constraints
* Do not jump directly into coding
* Do not assume missing requirements
* Do not skip validation

## Extensions
* Git integration (branch per feature)
* Live debugging hooks
* Test generation support
* Multi-agent parallel execution

## Philosophy
* Think before coding
* Plan before execution
* Verify before completion
