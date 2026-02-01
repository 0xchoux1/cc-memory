---
name: assess
description: OODA Assess - Analyze situation and generate options
allowed-tools: Read, Grep, Glob, mcp__cc-memory__*
---

# OODA Assess Phase

Trigger the OODA Assess skill to analyze observations and generate options.

## Instructions

Execute the assessment process:

1. **Retrieve Observation State**
   - Use `mcp__cc-memory__working_get` with key "ooda_state"
   - If missing, warn and suggest /observe first

2. **Search Related Knowledge**
   - Use `mcp__cc-memory__pattern_list` for relevant patterns
   - Use `mcp__cc-memory__episode_search` for past experiences
   - Use `mcp__cc-memory__semantic_search` for facts and procedures
   - Use `mcp__cc-memory__smart_recall` for comprehensive search

3. **Analyze Situation**
   - Compare with past experiences
   - Identify applicable patterns
   - Assess risks and uncertainties

4. **Generate Options**
   - Create 2-4 viable approaches
   - For each: description, pros, cons, effort, risk
   - Provide recommendation with reasoning

5. **Update Working Memory**
   Save assessment to `mcp__cc-memory__working_set`:
   - key: "ooda_state"
   - type: "decision"
   - priority: "high"
   - tags: ["ooda", "assess"]

## Additional Context
$ARGUMENTS

## Output

Provide assessment summary with options and recommendation.
Confirm ready for /plan phase.

Use Japanese if user has been communicating in Japanese.
