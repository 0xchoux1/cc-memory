---
name: OODA Escalate
description: This skill should be used when the user asks to "escalate", "need help", "stuck", "blocked", "can't proceed", "uncertain", "request assistance", "human review needed", or when autonomous operation encounters blockers, errors, or situations requiring human judgment. Provides structured escalation and problem reporting.
version: 1.0.0
---

# OODA Escalate - Problem Escalation Phase

This skill enables structured escalation when autonomous operation encounters blockers, errors, or situations requiring human judgment.

## Purpose

Escalate phase handles situations requiring intervention:
- Report blockers preventing progress
- Request human judgment for decisions
- Document errors needing review
- Provide structured problem context
- Enable informed human decision-making

## When to Escalate

Trigger escalation in these scenarios:

**Blockers:**
- Missing permissions or access
- Required resources unavailable
- Dependencies unresolvable
- External system failures

**Uncertainty:**
- Decision confidence below threshold (<0.5)
- Multiple conflicting patterns
- Novel situation with no precedent
- Ambiguous requirements

**Errors:**
- Repeated failures after retries
- Unrecoverable errors
- Data integrity concerns
- Security-related issues

**Policy:**
- Actions requiring approval
- Destructive operations
- Production changes
- Cost implications

## Escalation Process

### Step 1: Gather Context

Collect all relevant information:

**From Working Memory:**
Use `mcp__cc-memory__working_get` with key `ooda_state` to retrieve current OODA state.

**From Execution:**
Use `mcp__cc-memory__working_get` with key `ooda_execution` for any in-progress execution state.

**Error Context:**
- Stack traces if available
- Error messages
- Attempted remediation

### Step 2: Categorize Issue

Classify the escalation type:

| Type | Description | Urgency |
|------|-------------|---------|
| `blocker` | Cannot proceed at all | High |
| `decision` | Need human judgment | Medium |
| `error` | Error requiring review | Medium |
| `approval` | Action needs approval | Low |
| `information` | Need more context | Low |

### Step 3: Structure Escalation

Create structured escalation report:

```json
{
  "timestamp": "ISO timestamp",
  "escalation_type": "blocker/decision/error/approval/information",
  "urgency": "high/medium/low",
  "summary": "One-line problem summary",
  "context": {
    "ooda_phase": "Current OODA phase when escalating",
    "task": "What was being attempted",
    "observations": "Relevant observations",
    "attempted_actions": ["What was tried"]
  },
  "problem": {
    "description": "Detailed problem description",
    "root_cause": "Best understanding of cause",
    "impact": "What is blocked or affected"
  },
  "options": [
    {
      "option": "Possible resolution 1",
      "pros": ["Advantage"],
      "cons": ["Disadvantage"],
      "requires": "What is needed from human"
    }
  ],
  "recommendation": "Suggested path forward if any",
  "questions": [
    "Specific question 1?",
    "Specific question 2?"
  ]
}
```

### Step 4: Record Escalation

Store in episodic memory for tracking:

Use `mcp__cc-memory__episode_record` with:
- `type`: "error" (for blockers/errors) or "interaction" (for decisions/approval)
- `summary`: One-line escalation summary
- `details`: Full escalation context
- `importance`: 7-9 based on urgency
- `tags`: ["ooda", "escalate", escalation_type, urgency]
- `context`: {
    "projectPath": Current project path,
    "taskId": Task identifier if available
  }
- `outcome`: {
    "status": "partial",
    "resolution": "Escalated to user",
    "learnings": ["Situation that required escalation"]
  }

### Step 5: Present to User

Display clear escalation report:

```
## Escalation Report

### Type: [BLOCKER/DECISION/ERROR/APPROVAL/INFORMATION]
### Urgency: [HIGH/MEDIUM/LOW]

### Summary
[One-line summary of the issue]

### Context
- **Task:** [What was being attempted]
- **Phase:** [Which OODA phase]
- **Progress:** [What was completed before issue]

### Problem
[Detailed description of the issue]

**Root Cause:** [Best understanding]
**Impact:** [What is blocked]

### What Was Tried
1. [Attempted action 1]
2. [Attempted action 2]

### Options for Resolution

#### Option 1: [Name]
- Description: [What this involves]
- Requires: [What you need from user]
- Pros: [Advantages]
- Cons: [Disadvantages]

#### Option 2: [Name]
[Same structure]

### Recommendation
[Suggested path forward if any]

### Questions for You
1. [Specific question needing answer]
2. [Another question if applicable]

---
Please provide guidance to continue.
```

## Integration with OODA Loop

Escalation can occur from any phase:
- From **Observe**: Cannot gather required information
- From **Assess**: Cannot evaluate options with confidence
- From **Plan**: Cannot decide on approach
- From **Execute**: Cannot complete action

## Post-Escalation

After receiving human guidance:

**Resume OODA Loop:**
1. Update working memory with new information
2. Return to appropriate phase
3. Continue with human-provided direction

**Record Resolution:**
Update the episode with outcome:

Use `mcp__cc-memory__episode_update` with:
- `id`: Episode ID from escalation
- `outcome`: {
    "status": "success",
    "resolution": "How issue was resolved",
    "learnings": ["What was learned from escalation"]
  }

## Escalation Patterns

Record recurring escalation situations:

Use `mcp__cc-memory__pattern_create` with:
- `pattern`: Description of escalation pattern
- `confidence`: 0.7
- `related_tags`: ["escalation", domain tags]

This helps identify systemic issues that may need automation or policy changes.

## Shared Context

For team environments:

Use `mcp__cc-memory__shared_memory_set` with:
- `key`: "escalation_[timestamp]"
- `value`: Escalation data
- `tags`: ["escalation", "pending"]
- `visibility`: ["*"] for team-wide visibility

This enables other agents or team members to see pending escalations.

## Auto-Escalation Triggers

Configure automatic escalation for:
- Error count exceeds threshold
- Execution time exceeds limit
- Resource usage exceeds budget
- Security events detected

## Best Practices

1. **Be specific:** Clear problem description
2. **Be complete:** Include all relevant context
3. **Be actionable:** Provide options when possible
4. **Be timely:** Escalate early when stuck
5. **Be learning:** Record patterns for improvement

## De-escalation

When issue is resolved:
- Update episode with resolution
- Clear escalation from shared memory
- Resume normal OODA operation
- Consider if automation can prevent recurrence
