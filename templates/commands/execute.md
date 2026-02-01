---
name: execute
description: OODA Execute - Implement the plan and track progress
allowed-tools: Read, Write, Edit, Bash(*), Glob, Grep, mcp__cc-memory__*
---

# OODA Execute Phase

Trigger the OODA Execute skill to implement the planned actions.

## Instructions

Execute the implementation process:

1. **Retrieve Plan State**
   - Use `mcp__cc-memory__working_get` with key "ooda_state"
   - Verify action plan exists

2. **Initialize Tracking**
   Save execution state to `mcp__cc-memory__working_set`:
   - key: "ooda_execution"
   - type: "task_state"

3. **Execute Steps**
   For each step:
   - Announce step
   - Check dependencies
   - Execute action
   - Capture results
   - Verify completion
   - Check rollback triggers

4. **Handle Checkpoints**
   At defined checkpoints:
   - Verify checkpoint criteria
   - Rollback if criteria fail

5. **Handle Errors**
   On error:
   - Attempt recovery
   - If critical, use /escalate
   - Record with `mcp__cc-memory__episode_record` (type: "error")

6. **Verify Completion**
   - Check all success criteria
   - Determine outcome (success/partial/failure)

7. **Record Experience**
   Use `mcp__cc-memory__episode_record`:
   - type: "success" or "error"
   - Include full execution details
   - Add learnings

8. **Clean Up**
   Update ooda_state with results

## Additional Instructions
$ARGUMENTS

## Output

Provide execution summary with:
- Status (SUCCESS/PARTIAL/FAILED)
- Steps completed table
- Success criteria checklist
- Issues encountered
- Learnings

Use Japanese if user has been communicating in Japanese.
