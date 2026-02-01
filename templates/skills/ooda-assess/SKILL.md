---
name: OODA Assess
description: This skill should be used when the user asks to "assess", "analyze situation", "evaluate options", "orient", "understand context", "compare approaches", "what are the options", or mentions OODA orient/assess phase. Provides situation analysis and option generation based on observations.
version: 1.0.0
---

# OODA Assess - Situation Analysis Phase

This skill enables situation analysis and option generation as the second phase of the OODA loop, orienting understanding based on observations.

## Purpose

Assess phase analyzes observations and generates options:
- Interpret gathered observations
- Compare with historical patterns
- Identify potential approaches
- Evaluate risks and tradeoffs
- Recommend viable options

## Assessment Process

### Step 1: Retrieve Observation State

Load current observations from working memory:

Use `mcp__cc-memory__working_get` with key `ooda_state` to retrieve observation data from the observe phase.

If no observation state exists:
- Warn user to run /observe first
- Or trigger observation inline if context allows

### Step 2: Search Related Knowledge

Query memory systems for relevant context:

**Pattern Search:**
Use `mcp__cc-memory__pattern_list` with:
- `query`: Keywords from observations
- `min_confidence`: 0.6
- `limit`: 10

**Episode Search:**
Use `mcp__cc-memory__episode_search` with:
- `query`: Task description or error patterns
- `tags`: Relevant technology/domain tags
- `limit`: 10

**Semantic Search:**
Use `mcp__cc-memory__semantic_search` with:
- `query`: Technical terms from observations
- `type`: "fact" or "procedure"
- `limit`: 10

**Smart Recall:**
Use `mcp__cc-memory__smart_recall` with:
- `query`: Comprehensive search of the situation
- `importance_weight`: 0.4
- `recency_weight`: 0.3
- `confidence_weight`: 0.3

### Step 3: Analyze Situation

Synthesize observations with retrieved knowledge:

**Pattern Matching:**
- Compare current situation to past experiences
- Identify which patterns apply
- Note similarities and differences

**Risk Assessment:**
- Identify potential failure modes
- Assess complexity and uncertainty
- Consider time and resource constraints

**Option Generation:**
- Generate 2-4 viable approaches
- For each option, identify:
  - Description
  - Pros and cons
  - Estimated effort
  - Risk level
  - Success probability

### Step 4: Structure Assessment

Organize analysis into structured format:

```json
{
  "timestamp": "ISO timestamp",
  "phase": "assess",
  "analysis": {
    "situation_summary": "Brief description of current state",
    "key_findings": [
      "Finding 1",
      "Finding 2"
    ],
    "applicable_patterns": [
      {
        "pattern_id": "id",
        "pattern": "description",
        "relevance": 0.8
      }
    ],
    "similar_episodes": [
      {
        "episode_id": "id",
        "summary": "description",
        "outcome": "success/failure",
        "learnings": []
      }
    ]
  },
  "options": [
    {
      "id": "option_1",
      "description": "Approach description",
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1"],
      "effort": "low/medium/high",
      "risk": "low/medium/high",
      "confidence": 0.8
    }
  ],
  "recommendation": {
    "preferred_option": "option_1",
    "reasoning": "Why this option is recommended"
  }
}
```

### Step 5: Update Working Memory

Store assessment results:

Use `mcp__cc-memory__working_set` with:
- `key`: "ooda_state"
- `value`: Merged observation + assessment data
- `type`: "decision"
- `priority`: "high"
- `tags`: ["ooda", "assess", "options"]
- `ttl`: 3600000 (1 hour)

## Output Format

Provide a clear assessment summary:

```
## Assessment Summary

### Situation Analysis
[Brief interpretation of observations]

### Key Findings
1. [Finding 1]
2. [Finding 2]

### Relevant Past Experience
- [Episode/Pattern 1]: [Relevance and learnings]
- [Episode/Pattern 2]: [Relevance and learnings]

### Options Identified

#### Option 1: [Name]
- Description: [What this approach involves]
- Pros: [Advantages]
- Cons: [Disadvantages]
- Effort: [Low/Medium/High]
- Risk: [Low/Medium/High]

#### Option 2: [Name]
[Same structure]

### Recommendation
**Preferred:** Option [N]
**Reasoning:** [Why this option is best given the situation]

### Next Step
Ready for /plan phase to detail implementation strategy.
```

## Integration with OODA Loop

This skill is Phase 2 of 4:
1. **Observe** (/observe) - Gather situational awareness
2. **Assess** (current) - Analyze and orient based on observations
3. **Plan** (/plan) - Decide on action strategy
4. **Execute** (/execute) - Implement the plan

## Decision Support

When confidence is low:
- Surface uncertainties explicitly
- Request clarification if needed
- Consider /escalate for human input

When multiple options are viable:
- Rank by confidence and risk
- Highlight key differentiators
- Let user confirm or adjust

## Memory Contribution

After assessment, optionally create patterns:

Use `mcp__cc-memory__pattern_create` if new patterns emerge:
- `pattern`: Description of observed pattern
- `confidence`: Based on evidence strength
- `related_tags`: Relevant domains

## Best Practices

1. **Be comprehensive:** Consider all relevant factors
2. **Be objective:** Present options fairly
3. **Be grounded:** Base recommendations on evidence
4. **Be clear:** Make tradeoffs explicit
5. **Be actionable:** Provide concrete next steps
