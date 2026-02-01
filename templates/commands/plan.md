---
name: plan
description: OODA Plan - Make decision and create action plan
allowed-tools: Read, mcp__cc-memory__*
---

# OODA Plan Phase

Trigger the OODA Plan skill to make decisions and create execution strategy.

## Instructions

Execute the planning process:

1. **Retrieve Assessment State**
   - Use `mcp__cc-memory__working_get` with key "ooda_state"
   - Verify options exist from assess phase

2. **Make Decision**
   - Review recommended option
   - Validate against constraints
   - Select approach (or use user-specified choice)

3. **Create Action Plan**
   - Break into concrete steps
   - Identify dependencies
   - Estimate durations
   - Define checkpoints

4. **Define Success Criteria**
   - Set measurable acceptance criteria
   - Plan verification methods

5. **Plan Risk Mitigation**
   - Anticipate failures
   - Define rollback triggers
   - Create rollback steps

6. **Save Plan**
   Update `mcp__cc-memory__working_set`:
   - key: "ooda_state"
   - type: "task_state"
   - priority: "high"
   - tags: ["ooda", "plan"]

7. **Record Decision Pattern**
   Use `mcp__cc-memory__semantic_create` with type "pattern"

## User Preference
$ARGUMENTS

## Output

Provide plan summary with:
- Selected approach and rationale
- Action steps table
- Success criteria checklist
- Risk mitigation plan

Confirm ready for /execute phase.

Use Japanese if user has been communicating in Japanese.
