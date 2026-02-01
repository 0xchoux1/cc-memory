---
name: escalate
description: OODA Escalate - Report blockers and request human guidance
allowed-tools: Read, mcp__cc-memory__*
---

# OODA Escalate Phase

Trigger the OODA Escalate skill to report issues and request guidance.

## Instructions

Execute the escalation process:

1. **Gather Context**
   - Use `mcp__cc-memory__working_get` with key "ooda_state"
   - Use `mcp__cc-memory__working_get` with key "ooda_execution"
   - Collect error context if available

2. **Categorize Issue**
   Determine escalation type:
   - `blocker`: Cannot proceed at all
   - `decision`: Need human judgment
   - `error`: Error requiring review
   - `approval`: Action needs approval
   - `information`: Need more context

3. **Determine Urgency**
   - `high`: Blocking all progress
   - `medium`: Blocking current task
   - `low`: Can continue with workaround

4. **Structure Report**
   Include:
   - Summary of issue
   - Context (task, phase, progress)
   - Problem description and root cause
   - Options for resolution
   - Specific questions

5. **Record Escalation**
   Use `mcp__cc-memory__episode_record`:
   - type: "error" or "interaction"
   - importance: 7-9 based on urgency
   - tags: ["ooda", "escalate", type, urgency]

6. **Present to User**
   Clear formatted escalation report

## Issue Description
$ARGUMENTS

## Output

Provide escalation report with:
- Type and urgency
- Clear problem summary
- Context of what was being attempted
- Options for resolution
- Specific questions for guidance

Use Japanese if user has been communicating in Japanese.
