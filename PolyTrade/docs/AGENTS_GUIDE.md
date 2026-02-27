# PolyTrade Agent System Guide

## Overview

PolyTrade uses **Claude Code subagents** - specialized AI agents that can be invoked on-demand for specific tasks. Each agent is an expert in a particular domain.

**Location**: [.claude/agents/](.claude/agents/)

## Available Agents (9 Total)

### Development Agents

#### 1. 🎯 trading-specialist
**Expert in**: Algorithmic trading, market making, order management

**Use when**:
- Implementing trading logic and algorithms
- Order book management
- Position sizing and risk management
- Exchange-specific trading features
- Market making strategies

**Tools**: Full read/write access with command execution

---

#### 2. 🔌 api-integrator
**Expert in**: External exchange APIs (Polymarket, Deribit, Binance)

**Use when**:
- API client implementation
- WebSocket handling
- Rate limiting and retry logic
- Authentication and signatures
- API error handling

**Tools**: Full read/write access with command execution

---

#### 3. 🗄️ database-architect
**Expert in**: Event sourcing, CQRS architecture, database design

**Use when**:
- Database schema design and modifications
- Event sourcing implementation
- Query optimization
- SQL injection prevention
- Data integrity and auditability

**Tools**: Full read/write access with command execution

---

#### 4. 🧪 test-engineer
**Expert in**: Unit tests, integration tests, TDD

**Use when**:
- Writing Jest tests
- Test coverage improvement
- Integration testing
- Test data factories
- Mocking strategies

**Tools**: Full read/write access with command execution

---

#### 5. 🐛 debugger
**Expert in**: Error diagnosis, test failures, runtime issues

**Use when**:
- Bug fixing and troubleshooting
- Test failure diagnosis
- Root cause analysis
- Error investigation
- Fix verification

**Tools**: Full read/write access with command execution

---

#### 6. ⚡ performance-optimizer
**Expert in**: Performance analysis and optimization

**Use when**:
- Latency optimization
- Database query performance
- Memory leak detection
- System bottleneck identification
- Benchmarking and profiling

**Tools**: Full read/write access with command execution

---

### Review Agents (Read-Only)

#### 7. 👀 code-reviewer
**Expert in**: Code quality and best practices

**Use when**:
- Code quality review
- Best practices validation
- TypeScript patterns
- Error handling review
- Before committing changes

**Tools**: Read-only (Grep, Glob, Read)

---

#### 8. 🔒 security-auditor
**Expert in**: Security for trading platforms

**Use when**:
- Security vulnerability assessment
- Credential management review
- SQL injection detection
- Authentication/authorization review
- Security best practices

**Tools**: Read-only (Grep, Glob, Read)

---

### Research Agent

#### 9. 🌐 research-specialist
**Expert in**: Web research, documentation analysis

**Use when**:
- Finding API documentation
- Library/framework research
- Best practices research
- Error message investigation
- Version compatibility checking
- Code example discovery

**Tools**: Read, Grep, Glob, Bash, WebSearch, WebFetch

---

## Usage Examples

### In Natural Language
```
Use the trading-specialist agent to review the order placement logic
```

### Multiple Agents
```
Have the code-reviewer check my changes, then use the test-engineer to add tests
```

### Specific Tasks
```
Ask the research-specialist to find the latest Polymarket CLOB API documentation
```

### Background Execution
```
Use the performance-optimizer agent in the background to analyze query performance
```

## Agent Selection Guide

| Task Type | Recommended Agent |
|-----------|------------------|
| Add new trading feature | trading-specialist |
| Integrate new exchange | api-integrator |
| Database schema change | database-architect |
| Write tests | test-engineer |
| Fix bugs | debugger |
| Slow queries | performance-optimizer |
| Pre-commit review | code-reviewer |
| Security check | security-auditor |
| Find documentation | research-specialist |

## Tool Access Summary

| Agent | Read | Write | Edit | Bash | Purpose |
|-------|------|-------|------|------|---------|
| trading-specialist | ✅ | ✅ | ✅ | ✅ | Implement trading logic |
| api-integrator | ✅ | ✅ | ✅ | ✅ | Integrate APIs |
| database-architect | ✅ | ✅ | ✅ | ✅ | Design/modify database |
| test-engineer | ✅ | ✅ | ✅ | ✅ | Write tests |
| debugger | ✅ | ✅ | ✅ | ✅ | Fix bugs |
| performance-optimizer | ✅ | ✅ | ✅ | ✅ | Optimize performance |
| code-reviewer | ✅ | ❌ | ❌ | ❌ | Code reviews |
| security-auditor | ✅ | ❌ | ❌ | ❌ | Security audits |
| research-specialist | ✅ | ❌ | ❌ | ✅ | Research & documentation |

**Legend:**
- ✅ = Has access
- ❌ = No access (by design for safety)

## Best Practices

### 1. Use the Right Agent
Each agent is specialized. Don't use the trading-specialist for database work.

### 2. Read-Only Agents are Intentional
code-reviewer and security-auditor can't modify code. This ensures safe audits without unintended changes.

### 3. Combine Agents
Use multiple agents in sequence:
1. debugger fixes the bug
2. test-engineer adds regression tests
3. code-reviewer validates the changes

### 4. Background Execution
For long-running tasks (research, optimization), agents can run in the background.

### 5. Research First
Use research-specialist before implementing unfamiliar APIs or libraries.

## Directory Structure

```
.claude/
├── agents/                  # Agent definitions
│   ├── README.md           # This guide
│   ├── trading-specialist.md
│   ├── api-integrator.md
│   ├── database-architect.md
│   ├── test-engineer.md
│   ├── debugger.md
│   ├── performance-optimizer.md
│   ├── code-reviewer.md
│   ├── security-auditor.md
│   └── research-specialist.md
├── agent-docs/             # API documentation
│   ├── Orderbook_polymarket.txt
│   └── polymarket_api.txt
└── mcp.json                # MCP server configuration
```

## Customization

To modify an agent:
1. Open the agent's `.md` file
2. Edit the YAML frontmatter or system prompt
3. Save - changes take effect immediately

To create a new agent:
1. Create a new `.md` file in [.claude/agents/](.claude/agents/)
2. Add YAML frontmatter
3. Write the system prompt
4. Invoke by name

## Technical Details

### Agent Format

Each agent is defined in a Markdown file with YAML frontmatter:

```markdown
---
name: my-agent
description: Brief description
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

You are an expert in [domain]...
```

### Model Options

- `sonnet` - Claude Sonnet 4.5 (recommended, balanced)
- `haiku` - Claude Haiku 4.5 (faster, simpler tasks)
- `opus` - Claude Opus 4.5 (complex reasoning)

### Parallel Execution

Multiple agents can run in parallel:
```
Launch trading-specialist and test-engineer in parallel
```

## Troubleshooting

### Agent not responding?
1. Check file has `.md` extension
2. Verify YAML frontmatter syntax
3. Reload VSCode window

### Agent can't access files?
1. Verify tools in frontmatter include `Read`
2. Check file permissions
3. Ensure path is correct

### Need web access for research?
1. Check [../.claude/mcp.json](../.claude/mcp.json) is configured
2. Verify GitHub MCP server is active
3. Ensure internet connection

## Platform Support

✅ **Windows**: Fully supported (no additional setup)
✅ **macOS**: Fully supported
✅ **Linux**: Fully supported

No external dependencies required - agents work out of the box with Claude Code.

---

For more details, see [.claude/agents/README.md](.claude/agents/README.md)
