---
name: OODA Plan
description: This skill should be used when the user asks to "plan", "decide approach", "create strategy", "make decision", "choose option", "how to proceed", "action plan", or mentions OODA decide/plan phase. Provides decision-making and action planning based on assessment.
version: 1.0.0
---

# OODA Plan - Decision and Strategy Phase

This skill enables decision-making and action planning as the third phase of the OODA loop, creating a concrete execution strategy.

## Purpose

Plan phase makes decisions and creates execution strategy:
- Select optimal approach from options
- Create detailed action steps
- Define success criteria
- Anticipate potential issues
- Prepare rollback strategy

## Planning Process

### Step 1: Retrieve Assessment State

Load current state from working memory:

Use `mcp__cc-memory__working_get` with key `ooda_state` to retrieve observation and assessment data.

Verify required data exists:
- Observations from observe phase
- Options from assess phase
- Recommendation if available

If incomplete, suggest running prior phases.

### Step 2: Make Decision

Select the approach to execute:

**If recommendation exists:**
- Review the recommended option
- Validate against current constraints
- Confirm or adjust as needed

**If multiple equal options:**
- Apply decision criteria:
  - Lower risk preferred
  - Lower effort preferred
  - Higher confidence preferred
  - Faster feedback preferred
- Document the decision rationale

**If uncertainty is high:**
- Consider /escalate for human input
- Or choose most reversible option

### Step 3: Create Action Plan

Break decision into concrete steps:

**Step Decomposition:**
1. List all required actions
2. Identify dependencies between steps
3. Estimate duration for each step
4. Define checkpoints and milestones

**Success Criteria:**
- Define what "done" looks like
- Set measurable acceptance criteria
- Identify verification methods

**Risk Mitigation:**
- Anticipate potential failures
- Plan fallback actions
- Define rollback triggers

### Step 4: Structure Plan

Organize plan into structured format:

```json
{
  "timestamp": "ISO timestamp",
  "phase": "plan",
  "decision": {
    "selected_option": "option_id",
    "rationale": "Why this option was chosen",
    "confidence": 0.85
  },
  "action_plan": {
    "steps": [
      {
        "step": 1,
        "action": "Description of action",
        "duration_estimate": "5 minutes",
        "dependencies": [],
        "verification": "How to verify completion"
      }
    ],
    "checkpoints": [
      {
        "after_step": 2,
        "check": "What to verify",
        "rollback_trigger": "Condition for rollback"
      }
    ],
    "total_estimate": "30 minutes"
  },
  "success_criteria": [
    "Criterion 1",
    "Criterion 2"
  ],
  "risks": [
    {
      "risk": "Description",
      "probability": "low/medium/high",
      "mitigation": "How to handle"
    }
  ],
  "rollback_plan": {
    "trigger": "When to rollback",
    "steps": ["Rollback step 1", "Rollback step 2"]
  }
}
```

### Step 5: Save Plan and Create Pattern

Store plan and record decision:

**Update Working Memory:**
Use `mcp__cc-memory__working_set` with:
- `key`: "ooda_state"
- `value`: Complete state with plan
- `type`: "task_state"
- `priority`: "high"
- `tags`: ["ooda", "plan", "decision"]
- `ttl`: 7200000 (2 hours)

**Record Decision Pattern:**
Use `mcp__cc-memory__semantic_create` with:
- `name`: Descriptive decision name
- `type`: "pattern"
- `description`: Decision context and rationale
- `confidence`: Based on assessment confidence
- `tags`: Relevant technology/domain tags

## Output Format

Provide a clear plan summary:

```
## Plan Summary

### Decision Made
**Selected Approach:** [Option name]
**Rationale:** [Why this was chosen]
**Confidence:** [High/Medium/Low]

### Action Plan

| Step | Action | Duration | Dependencies |
|------|--------|----------|--------------|
| 1 | [Action 1] | [Time] | None |
| 2 | [Action 2] | [Time] | Step 1 |
| 3 | [Action 3] | [Time] | Step 2 |

**Total Estimated Time:** [Duration]

### Checkpoints
- After Step [N]: [What to verify]

### Success Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]

### Risk Mitigation
| Risk | Probability | Mitigation |
|------|-------------|------------|
| [Risk 1] | [Low/Med/High] | [Action] |

### Rollback Plan
**Trigger:** [Condition]
**Actions:** [Steps to rollback]

### Next Step
Ready for /execute phase to implement the plan.
```

## Integration with OODA Loop

This skill is Phase 3 of 4:
1. **Observe** (/observe) - Gather situational awareness
2. **Assess** (/assess) - Analyze and orient based on observations
3. **Plan** (current) - Decide on action strategy
4. **Execute** (/execute) - Implement the plan

## Decision Quality

Record decisions for future learning:

**High-stakes decisions:**
- Document thoroughly in semantic memory
- Include context for future reference
- Tag with relevant domains

**Recurring decisions:**
- Check if pattern already exists
- Update confidence if pattern applies
- Create new pattern if novel

## User Confirmation

Before executing high-risk plans:
- Present plan summary for review
- Highlight irreversible actions
- Request explicit confirmation

For routine operations:
- Proceed with standard plan
- Log for transparency
- Enable async review

## Best Practices

1. **Be specific:** Concrete actionable steps
2. **Be realistic:** Accurate time estimates
3. **Be cautious:** Plan for failures
4. **Be documented:** Record rationale
5. **Be reversible:** Enable rollback when possible
