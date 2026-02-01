---
name: OODA Execute
description: This skill should be used when the user asks to "execute", "implement plan", "run the plan", "do it", "take action", "proceed", "apply changes", or mentions OODA act/execute phase. Provides structured execution of planned actions with progress tracking.
version: 1.0.0
---

# OODA Execute - Action Implementation Phase

This skill enables structured execution of planned actions as the fourth phase of the OODA loop, implementing the decided strategy with progress tracking.

## Purpose

Execute phase implements the plan and tracks results:
- Execute planned action steps
- Track progress and outcomes
- Handle errors and adapt
- Verify success criteria
- Record experience for learning

## Execution Process

### Step 1: Retrieve Plan State

Load current plan from working memory:

Use `mcp__cc-memory__working_get` with key `ooda_state` to retrieve the complete OODA state including plan.

Verify plan exists:
- Action steps defined
- Success criteria set
- Rollback plan available

If no plan exists, suggest running /plan first.

### Step 2: Initialize Execution Tracking

Create execution context:

```json
{
  "execution_start": "ISO timestamp",
  "current_step": 0,
  "completed_steps": [],
  "step_results": [],
  "status": "in_progress"
}
```

Update working memory with execution state:

Use `mcp__cc-memory__working_set` with:
- `key`: "ooda_execution"
- `value`: Execution tracking data
- `type`: "task_state"
- `priority`: "high"
- `tags`: ["ooda", "execute", "tracking"]

### Step 3: Execute Action Steps

For each step in the action plan:

**Pre-Step:**
1. Announce step being executed
2. Check dependencies are met
3. Verify resources available

**Execute:**
1. Perform the planned action
2. Capture output and results
3. Record any errors or warnings

**Post-Step:**
1. Verify step completion
2. Update progress tracking
3. Check for rollback triggers

**Checkpoint Handling:**
At defined checkpoints:
- Verify checkpoint criteria
- If failed, consider rollback
- If passed, continue to next step

### Step 4: Handle Errors

When errors occur during execution:

**Recoverable Errors:**
- Attempt automatic recovery
- Try alternative approach
- Log error and resolution

**Critical Errors:**
- Stop execution
- Trigger rollback if appropriate
- Use /escalate for human intervention

**Record Error:**
Use `mcp__cc-memory__episode_record` with:
- `type`: "error"
- `summary`: Brief error description
- `details`: Full error context and attempted resolution
- `importance`: 6-8 based on severity
- `tags`: ["ooda", "execute", "error"]
- `outcome`: { status: "failure", learnings: [...] }

### Step 5: Verify Completion

After all steps executed:

**Check Success Criteria:**
- Verify each criterion is met
- Document verification method
- Note any partial success

**Determine Outcome:**
- "success": All criteria met
- "partial": Some criteria met
- "failure": Critical criteria not met

### Step 6: Record Experience

Store execution results in episodic memory:

Use `mcp__cc-memory__episode_record` with:
- `type`: "success" or "error" based on outcome
- `summary`: Brief execution summary
- `details`: Complete execution log with steps and results
- `importance`: 7-9 based on significance
- `tags`: ["ooda", "execute", relevant domain tags]
- `context`: {
    "projectPath": Current project path,
    "files": List of affected files,
    "taskId": Task identifier if available
  }
- `outcome`: {
    "status": "success"/"failure"/"partial",
    "resolution": What was accomplished,
    "learnings": Lessons learned
  }

### Step 7: Clean Up State

After execution completes:

**Update Working Memory:**
Use `mcp__cc-memory__working_set` with:
- `key`: "ooda_state"
- `value`: Updated state with execution results
- `type`: "context"
- `priority`: "medium"
- `tags`: ["ooda", "complete"]

**Optional: Clear Execution State:**
Use `mcp__cc-memory__working_delete` with key "ooda_execution" if no longer needed.

## Output Format

Provide execution summary:

```
## Execution Summary

### Status: [SUCCESS/PARTIAL/FAILED]

### Steps Completed

| Step | Action | Result | Duration |
|------|--------|--------|----------|
| 1 | [Action 1] | [Pass/Fail] | [Time] |
| 2 | [Action 2] | [Pass/Fail] | [Time] |

### Success Criteria

- [x] [Criterion 1]: [Verified]
- [x] [Criterion 2]: [Verified]
- [ ] [Criterion 3]: [Not met - reason]

### Results
[Summary of what was accomplished]

### Issues Encountered
[Any problems and how they were handled]

### Learnings
- [Learning 1]
- [Learning 2]

### Next Steps
[If partial/failed: Recommendations for follow-up]
[If success: Confirmation of completion]
```

## Integration with OODA Loop

This skill is Phase 4 of 4:
1. **Observe** (/observe) - Gather situational awareness
2. **Assess** (/assess) - Analyze and orient based on observations
3. **Plan** (/plan) - Decide on action strategy
4. **Execute** (current) - Implement the plan

## Loop Continuation

After execution:

**If Success:**
- Record in episodic memory
- Return to ready state
- Available for next OODA cycle

**If Partial/Failed:**
- Consider automatic re-observation
- Trigger new OODA cycle
- Or escalate to user

**For Continuous Tasks:**
- Loop back to /observe
- Begin next iteration
- Track iteration count

## Rollback Execution

When rollback is triggered:

1. Stop current execution
2. Execute rollback steps in reverse order
3. Verify rollback success
4. Record rollback in memory
5. Report status to user

## Progress Visibility

For long-running executions:

- Provide step-by-step updates
- Show progress percentage
- Allow interruption if needed
- Enable pause/resume when possible

## Best Practices

1. **Be transparent:** Show what is happening
2. **Be resilient:** Handle errors gracefully
3. **Be traceable:** Log all actions
4. **Be reversible:** Enable undo when possible
5. **Be learning:** Record experience for future
