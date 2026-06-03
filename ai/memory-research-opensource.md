# 开源 AI 记忆框架深度调研报告

> 调研日期：2026-06-03
> 研究范围：Mem0、LangChain Memory、LlamaIndex、ChromaDB、CrewAI、AutoGPT/BabyAGI
> 数据来源：官方文档、GitHub 仓库、学术论文 (ArXiv)、技术博客（2025-2026）

---

## 目录

1. [Mem0](#1-mem0)
2. [LangChain Memory](#2-langchain-memory)
3. [LlamaIndex](#3-llamaindex)
4. [ChromaDB](#4-chromadb)
5. [CrewAI](#5-crewai)
6. [AutoGPT / BabyAGI](#6-autogpt--babyagi)
7. [综合对比](#7-综合对比)
8. [选型建议](#8-选型建议)

---

## 1. Mem0

### 概述

Mem0 是目前开源社区最受关注的 Universal Memory Layer，GitHub 约 48,000 Star，2025 年 10 月获得 2400 万美元融资。定位为"为 AI Agent 打造的可扩展长期记忆"。

**核心论文**: *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory* (ArXiv 2504.19413, 2025)

### 记忆层级设计

Mem0 采用 **三级作用域层次**:

| 层级 | 作用域 | 说明 |
|------|--------|------|
| **用户级记忆** (`user`) | 跨会话持久化 | 记住用户偏好、历史行为 |
| **会话级记忆** (`session`) | 当前交互上下文 | 当前对话中的瞬时信息 |
| **智能体级记忆** (`agent`) | AI 自身知识 | Agent 学习到的知识和经验 |

### 存储格式与后端

Mem0 的核心特点是 **向量数据库 + 图数据库双引擎架构**，是所有开源方案中后端支持最全面的：

**向量数据库支持**:
| 向量存储 | 说明 |
|---------|------|
| Qdrant | Docker 本地部署，端口 6333 |
| Pinecone | 云端向量数据库 |
| FAISS | Meta 开源，纯本地 |
| Milvus | 分布式向量数据库 |
| Chroma | 轻量级嵌入式向量数据库 |

**图数据库支持** (Mem0 独有):
| 图存储 | 说明 |
|-------|------|
| Neo4j | 企业级图数据库 |
| Memgraph | 高性能内存图数据库 |
| Kuzu | 嵌入式图数据库 |

**辅助存储**: SQLite 用于记录 ADD/UPDATE/DELETE 历史。

### 检索策略

**混合检索（Hybrid Search）三阶段流程**:

```
查询输入
  → LLM 查询处理（自动生成过滤条件）
    → 并行执行:
        ├── 向量搜索 (语义相似度)
        └── 图搜索 (关系遍历)
    → 合并排序（带相关性分数、元数据、时间戳）
    → 可选重排序 (Reranker)
```

- **向量搜索**: 通过 embedding 进行语义相似度匹配
- **图搜索**: 实体关系遍历，例如"谁是我的朋友？他的狗叫什么？"
- **重排序**: 可选的 Reranker 提升结果质量

### 记忆去重与更新

- **冲突解决机制**: 新信息与现有记忆比对 → 自动识别矛盾 → 合并/更新/标记
- LLM 从对话中提取关键信息，识别实体及关系
- 实体关系自动提取和同步到图数据库

### Token 管理策略

- 声明节省 **90% token** (相对 OpenAI Memory 全上下文方式)
- 响应准确率提升 **26%**
- 延迟降低 **91%** (P95)
- 策略: 动态提取关键信息 + 选择性检索 + 摘要替代原文

### 本地部署适合度: ★★★★★ (5/5)

- 完全支持本地化: Ollama 本地嵌入 (`mxbai-embed-large`) + Qdrant Docker + Kuzu 本地图数据库
- 支持 MCP 协议，可通过 OpenMemory MCP 连接 Claude Desktop、Cursor 等
- 数据完全本地控制，隐私安全

---

## 2. LangChain Memory

### 概述

LangChain 是最早的 LLM 应用框架之一，其 Memory 模块提供了 **6 种主流记忆类型**，覆盖从简单到复杂的各种场景。LangChain 2025 年新增 LangMem SDK，提供更先进的持久化记忆能力。

### 记忆层级设计

LangChain 本身没有显式的记忆层级设计，而是通过不同 Memory 类型覆盖不同需求:

| Memory 类型 | 覆盖层级 | 说明 |
|-------------|---------|------|
| ConversationBufferMemory | 短期/工作记忆 | 完整保存所有对话 |
| ConversationBufferWindowMemory | 短期记忆 | 滑动窗口保留最近 K 轮 |
| ConversationTokenBufferMemory | 短期记忆 | 按 Token 数量截断 |
| ConversationSummaryMemory | 长期记忆(压缩) | LLM 摘要替代原文 |
| ConversationSummaryBufferMemory | 混合记忆 | 近期原文 + 远期摘要 |
| VectorStoreRetrieverMemory | 长期记忆 | 向量化存储 + 语义检索 |

### 存储格式与后端

| 类型 | 存储格式 | 后端 |
|------|---------|------|
| BufferMemory | 纯文本对话历史 | Python 内存 |
| BufferWindowMemory | 最近 K 轮文本 | Python 内存 |
| TokenBufferMemory | 按 Token 截断文本 | Python 内存 |
| SummaryMemory | LLM 生成摘要文本 | Python 内存 |
| SummaryBufferMemory | 近期原文 + 远期摘要 | Python 内存 |
| VectorStoreRetrieverMemory | 向量嵌入 | 任意向量数据库 (Chroma/Pinecone/FAISS 等) |

**LangMem SDK** (2025 年新增):
- 持久化存储层，支持 PostgreSQL、SQLite、Redis、MongoDB
- 命名空间记忆: user/session/agent 三层作用域
- 自动语义去重
- MongoDB Atlas Vector Search 集成，检索延迟 < 100ms

### 检索策略

- **Buffer/Window/Token 类型**: 直接读取内存中的对话历史，无检索
- **Summary 类型**: 读取 LLM 生成的摘要文本
- **VectorStoreRetrieverMemory**: 语义向量检索，将查询编码为向量 → ANN 搜索 → 返回最相关历史

### Token 管理策略

| 策略 | Token 控制效果 |
|------|---------------|
| ConversationBufferMemory | ❌ 无限制，线性增长 |
| ConversationBufferWindowMemory (K=5) | ✅ 固定窗口，O(1) |
| ConversationTokenBufferMemory (limit=2000) | ✅ 精确 Token 控制 |
| ConversationSummaryMemory | ✅ 最大化压缩 |
| ConversationSummaryBufferMemory | ✅ 近期原文 + 远期摘要平衡 |
| VectorStoreRetrieverMemory | ✅ 按需检索，灵活控制 |

### 本地部署适合度: ★★★★☆ (4/5)

- 框架本身 Python 本地运行，所有 Memory 类型均为纯 Python 实现
- VectorStoreRetrieverMemory 需外部向量数据库（可选用 Chroma 等本地向量库）
- 依赖外部 LLM API 进行摘要生成和嵌入

---

## 3. LlamaIndex

### 概述

LlamaIndex 是专注于数据索引和检索的框架，其记忆系统属于 Agent 功能的附属模块。**重要变更**: 旧版 `ChatMemoryBuffer` 已被官方标记为弃用 (deprecated)，推荐使用新一代 `Memory` 类。

### 记忆层级设计

**旧版 ChatMemoryBuffer (已弃用)**:
- 简单缓冲区，无分层设计
- 仅存储聊天消息序列

**新版 Memory 类**:
- 更灵活的 Agent 记忆管理
- 支持与多种聊天存储后端集成
- 具体层级设计需参考[最新文档](https://docs.llamaindex.ai/en/stable/module_guides/deploying/agents/memory/)

### 存储格式与后端

**旧版 ChatMemoryBuffer**:
- 纯 Python 内存存储，无持久化
- 存储格式: ChatMessage 对象列表

**新版 Memory**:
- 支持持久化后端扩展（具体支持列表见最新文档）
- 与 LlamaIndex 的存储上下文 (StorageContext) 集成

### 检索策略

**ChatMemoryBuffer 策略**:
- 简单 FIFO: 保留最后 X 条符合 token_limit 的消息
- `memory.get()`: 返回符合 token 限制的消息
- `memory.get_all()`: 获取全部消息（不受限制）

### Token 管理策略

- `token_limit` 参数控制（示例: 40000）
- 策略: 保留最后 N 条消息只要不超过 token 限制
- 属于简单的"最后符合限制"截断策略，无摘要压缩

### 本地部署适合度: ★★★★☆ (4/5)

- Python 框架本地运行
- 需要外部 LLM (OpenAI API 或本地模型)
- 新版 Memory 可能有更丰富的本地存储选项

---

## 4. ChromaDB

### 概述

ChromaDB 是一个 **AI 原生开源向量数据库**，定位为"AI 的开源搜索基础设施"。GitHub 27,000+ Star，基于 Rust 构建，提供 Python/JavaScript/Go/C# 客户端。**核心特点**: 它不是记忆框架本身，而是作为其他记忆框架的底层存储引擎。

### 记忆层级设计

ChromaDB 作为存储引擎，**不提供内置的记忆层级设计**。上层框架（Mem0、LangChain、CrewAI 等）在 ChromaDB 之上构建记忆层级。

通过 **Collection 机制** 可实现逻辑分层:
- 每个 Collection 可对应一个用户/会话/Agent
- 支持 100 万个 Collection/数据库
- 每个 Collection 最多 500 万条记录

### 存储格式与后端

| 特性 | 说明 |
|------|------|
| **内存模式** | 启动即用，适合开发测试 |
| **持久化模式** | 基于 DuckDB + Parquet 或 SQLite |
| **数据模型** | `{id, embedding, document, metadata}` |
| **嵌入生成** | 内置 embedding function (也可自定义) |
| **架构基础** | 基于对象存储 (S3/GCS)，智能分层 |

### 检索策略 — 统一查询接口

ChromaDB 提供 **4 种可组合的搜索方式**:

| 搜索方式 | 说明 |
|---------|------|
| **向量搜索** (Dense Vector) | 语义相似度，余弦距离/点积 |
| **稀疏向量搜索** (Sparse Vector) | BM25、SPLADE 算法，基于词汇 |
| **全文搜索** (Full-text) | Trigram、正则表达式 |
| **元数据过滤** (Metadata) | 过滤和分面搜索 |

**混合搜索**: 上述方式可任意组合，单次查询同时使用多种策略。

**性能指标** (@384维，10万向量):
- 召回率: 90-100%
- 热查询 p50: **20ms**，p99: **57ms**
- 冷查询 p50: 650ms

### Token 管理策略

ChromaDB 不负责 Token 管理——作为存储引擎，它只负责数据的写入和检索，Token 策略由上层框架决定。

### 本地部署适合度: ★★★★★ (5/5)

- pip install chromadb 即可
- 支持纯内存模式（零配置）
- 支持本地持久化（DuckDB + Parquet）
- 单节点 Docker 部署
- Apache 2.0 开源协议，无供应商锁定

---

## 5. CrewAI

### 概述

CrewAI 是多 Agent 协作框架，其记忆系统经过了重大重构。**重要变更**: 2025-2026 年，旧版的分离式记忆（短期/长期/实体/外部）已被 **统一 Memory 类** 取代。

### 记忆层级设计

**新版统一架构**:

旧版采用 4 种独立记忆类型（短期 ChromaDB / 长期 SQLite / 实体 ChromaDB / 外部集成），新版则通过 **层次化 Scope 树** 实现逻辑分层:

```
/
  /company              # 公司级知识
    /company/engineering
    /company/product
  /project              # 项目级上下文
    /project/alpha
    /project/beta
  /agent                # Agent 私有记忆
    /agent/researcher
    /agent/writer
```

**最佳实践**: `/{entity_type}/{identifier}` 模式，保持 2-3 层深度。

### Agent 间共享机制

| 模式 | 说明 |
|------|------|
| **Crew 级共享** (默认) | `memory=True` 时所有 Agent 共享同一记忆 |
| **MemoryScope** | 限制 Agent 只访问特定子树: `memory.scope("/agent/researcher")` |
| **MemorySlice** | 跨分支组合: `memory.slice(scopes=["/agent/writer", "/company/knowledge"])` |
| **Source/Private 标记** | 多用户隔离: `memory.remember(data, source="user:alice", private=True)` |

### 存储格式与后端

| 属性 | 旧版 | 新版 |
|------|------|------|
| **默认后端** | ChromaDB + SQLite | **LanceDB** (列式向量数据库) |
| **存储位置** | — | `./.crewai/memory` (或 `$CREWAI_STORAGE_DIR`) |
| **自定义后端** | 有限 | 实现 `StorageBackend` 协议即可 |

**支持的 Embedder (12 种)**:

| 提供者 | 模型 | 本地 |
|--------|------|:--:|
| OpenAI (默认) | text-embedding-3-small | ❌ |
| **Ollama** | mxbai-embed-large | ✅ |
| Hugging Face | all-MiniLM-L6-v2 | ✅ |
| Google AI | gemini-embedding-001 | ❌ |
| Cohere | embed-english-v3.0 | ❌ |
| VoyageAI | voyage-3 | ❌ |
| AWS Bedrock | amazon.titan-embed-text-v1 | ❌ |
| Azure OpenAI | text-embedding-ada-002 | ❌ |
| Google Vertex | gemini-embedding-001 | ❌ |
| Jina | jina-embeddings-v2-base-en | ❌ |
| IBM WatsonX | ibm/slate-30m-english-rtrvr | ❌ |
| 自定义 | callable 函数 | ✅ |

### 检索策略

**复合评分公式**:

```
composite = 0.5 × semantic_similarity + 0.3 × recency_decay + 0.2 × importance
```

| 权重参数 | 默认值 | 说明 |
|---------|--------|------|
| `semantic_weight` | 0.5 | 语义相似度权重 |
| `recency_weight` | 0.3 | 时间衰减权重 |
| `importance_weight` | 0.2 | LLM 推断的重要性权重 |
| `recency_half_life_days` | 30 | 时间衰减半衰期 |

**LLM 自动分析**: 保存时 LLM 自动推断 scope、categories、importance，减少手动配置。

### Token 管理策略

- LLM 自动分析查询意图，按需召回最相关记忆
- 通过 `query_analysis_threshold` (默认 200 字符) 跳过简单查询的 LLM 分析
- 记忆注入提示词时按相关性分数排序截断

### 本地部署适合度: ★★★★☆ (4/5)

- LanceDB 本地存储，无需外部数据库
- 支持 Ollama 本地嵌入（完全离线运行）
- 分析用 LLM 默认 gpt-4o-mini（可配置为本地模型）
- `CREWAI_STORAGE_DIR` 环境变量控制存储路径

---

## 6. AutoGPT / BabyAGI

### 6.1 AutoGPT

#### 概述

AutoGPT 是最具影响力的自主 Agent 框架之一，其记忆模块核心设计理念是 **解耦"思考"与"记忆"**: 将海量上下文从有限提示词卸载到外部向量数据库，按需检索。

#### 记忆层级设计

| 层级 | 存储位置 | 说明 |
|------|---------|------|
| **短期记忆** | 最近几轮操作缓存 | 高频访问，确保任务流程连贯性 |
| **长期记忆** | 向量数据库 | 归档已完成任务节点 + 去重老化策略 |
| **高层摘要** | 定期生成 | "本周主要完成了投资组合初稿"，压缩存储体积 |

#### 存储格式与后端

- **嵌入模型**: Sentence-BERT (768维向量)
- **向量数据库**: Chroma / Pinecone / FAISS
- **存储格式**: `{id, embedding(768维), document, metadata{timestamp, task_id}}`
- **写入**: 语义提取而非原始日志（例如"用户关注实践导向学习路径"）

#### 检索策略

- **纯向量语义匹配**: 查询编码 → ANN 近似最近邻搜索 → 返回 Top-K
- 识别模糊表达: "我之前查过的那个表格处理库"
- 余弦相似度排序

#### Token 管理策略

- 仅存储关键摘要而非完整对话日志
- 目标漂移预防: 每隔几步主动检索原始目标确认方向

#### BabyAGI

BabyAGI 经历了多次重大架构演变，代表了从简单向量存储到知识图谱的完整探索:

| 版本 | 时间 | 记忆架构 |
|------|------|---------|
| **原始 BabyAGI** | 2023.03 | Pinecone 向量存储 + text-embedding-ada-002 |
| BabyBeeAGI | 2023.04 | 会话字符串记忆，放弃 Pinecone |
| BabyFoxAGI | 2023.09 | 双层记忆: 最近 20 条 + 滚动摘要 + 反思 |
| Graphista | 2025.02 | 完整基于图的记忆系统 (Neo4j/FalkorDB) |
| **BabyAGI 3** | 2026.02 | SQLite + 知识图谱 + 嵌入搜索 |

**BabyAGI 3 完整记忆架构** (当前版本):
- SQLite 持久化事件日志
- LLM 驱动的实体提取
- 知识图谱结构化关系存储
- 基于向量的语义检索
- 动态上下文组装到系统提示词

#### 本地部署适合度

| 项目 | 评分 | 说明 |
|------|:--:|------|
| AutoGPT | ★★★★☆ (4/5) | Chroma/FAISS 本地向量库 + 本地 LLM 可选 |
| BabyAGI 3 | ★★★★☆ (4/5) | SQLite 本地存储 + 本地知识图谱 |

---

## 7. 综合对比

### 7.1 记忆层级设计对比

| 框架 | 短期记忆 | 长期记忆 | 工作记忆 | 设计哲学 |
|------|:--:|:--:|:--:|------|
| **Mem0** | Session 作用域 | User+Agent 向量+图持久化 | LLM 上下文 | 三级作用域 + 双引擎 |
| **LangChain** | Buffer/Window/Token | VectorStore/Summary | 对话窗口 | 多类型覆盖不同场景 |
| **LlamaIndex** | ChatMemoryBuffer | 新 Memory 类 | Token 限制窗口 | 简单缓冲 → 灵活扩展 |
| **ChromaDB** | — | Collection 组织 | — | 纯存储引擎 |
| **CrewAI** | Scope 树子层级 | LanceDB 持久化 | 复合评分检索 | Scope 树逻辑分层 |
| **AutoGPT** | 操作缓存 | 向量库 + 去重老化 | LLM 上下文 | 归档 + 摘要 |
| **BabyAGI 3** | 事件日志 | SQLite + 知识图谱 | 嵌入检索 | 图+嵌入双引擎 |

### 7.2 存储后端对比

| 框架 | 向量数据库 | 图数据库 | 关系数据库 | 文件存储 |
|------|:--:|:--:|:--:|:--:|
| **Mem0** | Qdrant/Pinecone/FAISS/Milvus/Chroma | Neo4j/Memgraph/Kuzu | SQLite | — |
| **LangChain** | Chroma/Pinecone/FAISS (via VectorStore) | — | — | — |
| **LlamaIndex** | 通过 StorageContext | — | — | — |
| **ChromaDB** | 自身(内置) | — | DuckDB/SQLite | Parquet |
| **CrewAI** | LanceDB (内置) | — | — | — |
| **AutoGPT** | Chroma/Pinecone/FAISS | — | — | — |
| **BabyAGI 3** | 嵌入搜索(SQLite) | 知识图谱 | SQLite | — |

### 7.3 检索策略对比

| 框架 | 向量搜索 | 图搜索 | 关键词 | 混合检索 | 重排序 |
|------|:--:|:--:|:--:|:--:|:--:|
| **Mem0** | ✅ | ✅ | ❌ | ✅ 向量+图并行 | ✅ |
| **LangChain** | ✅ (VectorStore) | ❌ | ❌ | ❌ | ❌ |
| **LlamaIndex** | ✅ (新 Memory) | ❌ | ❌ | ❌ | ❌ |
| **ChromaDB** | ✅ | ❌ | ✅ BM25/全文 | ✅ 向量+稀疏+全文 | ❌ |
| **CrewAI** | ✅ (LanceDB) | ❌ | ❌ | ❌ 复合评分 | ❌ |
| **AutoGPT** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **BabyAGI 3** | ✅ (嵌入搜索) | ✅ (知识图谱) | ❌ | ✅ 嵌入+图 | ❌ |

### 7.4 Token 管理策略对比

| 框架 | 策略 | 节省效果 |
|------|------|------|
| **Mem0** | 动态提取+选择性检索 | 节省 90% vs 全上下文 |
| **LangChain** | 窗口/Token/摘要 多策略可选 | 取决于所选类型 |
| **LlamaIndex** | FIFO + token_limit 截断 | 简单有效 |
| **ChromaDB** | 不负责 Token 管理 | — |
| **CrewAI** | 复合评分排序+按需检索 | LLM 自动优化 |
| **AutoGPT** | 关键摘要替代完整日志 | 显著降低 |
| **BabyAGI 3** | 动态上下文组装 | 按需注入 |

### 7.5 本地部署评分汇总

| 框架 | 评分 | 说明 |
|------|:--:|------|
| **Mem0** | ⭐⭐⭐⭐⭐ 5/5 | Ollama + Qdrant + Kuzu 全本地栈 |
| **ChromaDB** | ⭐⭐⭐⭐⭐ 5/5 | pip install 即可，嵌入式运行 |
| **LangChain** | ⭐⭐⭐⭐ 4/5 | 框架本地，需外部向量库+LLM |
| **LlamaIndex** | ⭐⭐⭐⭐ 4/5 | 框架本地，需外部 LLM |
| **CrewAI** | ⭐⭐⭐⭐ 4/5 | LanceDB 本地，支持 Ollama |
| **AutoGPT** | ⭐⭐⭐⭐ 4/5 | 可配置本地向量库+本地 LLM |
| **BabyAGI 3** | ⭐⭐⭐⭐ 4/5 | SQLite 本地，可配置本地模型 |

---

## 8. 选型建议

### 场景 1: 需要最强大的记忆能力 → Mem0

- 唯一的向量+图双引擎架构
- 最全面的后端支持（5 种向量库 + 3 种图数据库）
- 自动去重、冲突解决、实体关系提取
- 最适合需要复杂关系推理的场景

### 场景 2: 简单对话记忆 → LangChain Memory

- 最丰富的 Memory 类型选择
- 从最简单的 Buffer 到最复杂的 VectorStore 全覆盖
- 与 LangChain 生态深度集成
- 适合已有 LangChain 技术栈的项目

### 场景 3: 需要轻量级向量存储引擎 → ChromaDB

- 嵌入式运行，零运维
- 4 种搜索方式统一查询接口
- 作为底层存储被 Mem0/LangChain/AutoGPT 等广泛集成
- 适合作为任何 AI 应用的向量存储基础层

### 场景 4: 多 Agent 协作 → CrewAI

- Scope 树管理 Agent 间记忆隔离与共享
- 复合评分（语义+时间+重要性）召回
- LanceDB 内置存储，无需额外部署
- 最适合多 Agent 协作场景

### 场景 5: 自主任务 Agent → AutoGPT / BabyAGI 3

- AutoGPT: 成熟的任务执行框架 + 分层记忆
- BabyAGI 3: 最完整的图记忆探索（SQLite + 知识图谱 + 嵌入搜索）
- 适合构建自主任务执行系统

---

## 附录: 行业趋势

1. **混合架构是共识**: 2025-2026 年，向量数据库 + 知识图谱的混合架构正在成为生产级 Agent 记忆的主流选择
2. **存储后端整合**: 从维护分离的向量/图/关系数据库转向统一平台 (PostgreSQL + pgvector, MongoDB + Atlas Vector Search)
3. **LLM 自主记忆管理**: Letta (原 MemGPT) 和 Mem0 开创的模式——LLM 通过函数调用自主管理记忆——正在成为行业标准
4. **评估体系还在成熟中**: LoCoMo 基准是目前最常用的评估工具，但程序记忆质量、跨 Agent 一致性、投毒抵抗力等维度尚未覆盖
5. **CLAUDE.md 模式兴起**: 声明式记忆注入 (CLAUDE.md / AGENTS.md) 正在成为辅助记忆的新范式，Agent 可在会话中自主维护
