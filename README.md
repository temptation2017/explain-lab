# explain-lab

把 SQL 的 EXPLAIN / EXPLAIN ANALYZE 输出贴进来，在浏览器里本地画出计划树，并标出全表扫描、filesort、磁盘排序和行数估计偏差。**纯前端，不上传。**

在线试用：<https://temptation2017.github.io/explain-lab/>

## 做什么

- 自动识别常见格式：
  - MySQL 传统表格、`\\G` 竖排、`EXPLAIN FORMAT=JSON`、`FORMAT=TREE` / `EXPLAIN ANALYZE` 树
  - PostgreSQL 文本计划（含 ANALYZE 的 actual time）和 `EXPLAIN (FORMAT JSON)`
  - SQLite `EXPLAIN QUERY PLAN`（ascii 树或 `id|parent|notused|detail`）
- 把计划画成树：代价、估计行数、实际时间 / 实际行数、循环次数
- 标出值得注意的信号：全表 / 顺序扫描、未使用索引、filesort、临时表、Join Buffer、磁盘排序、相关子查询、过滤率偏低、估计行数与实际偏差过大
- 一键复制 Markdown 摘要，方便贴进评审或工单

全部在本机计算，不会把粘贴内容发到任何服务器，也不向数据库发真实查询。

## 怎么打开

- 打开 GitHub Pages：<https://temptation2017.github.io/explain-lab/>
- 或本地下载后双击 `index.html`，或：

```bash
python3 -m http.server 8080
# 浏览器访问 http://127.0.0.1:8080/
```

无需构建、无需 npm。

可选校验（零依赖，只需 Node.js）：

```bash
node test_explain.js
```

## 怎么用

1. 在数据库客户端执行 `EXPLAIN` 或 `EXPLAIN ANALYZE`（需要时加上 `FORMAT=JSON` / `FORMAT=TREE` / `EXPLAIN (ANALYZE, FORMAT JSON)`）。
2. 把完整输出（最好连表头一起）粘贴到左侧文本框。
3. 看右侧的方言识别、摘要标签、提示列表和计划树。
4. 用示例按钮对比：全表扫描、索引关联、MySQL JSON / TREE、PostgreSQL ANALYZE、SQLite QUERY PLAN。
5. 要把结论带走，点「复制 Markdown 摘要」。

## 示例

下列表名、行数和过滤条件都是虚构样本。规则按常见输出格式编写，不保证和某一种数据库版本或优化器的私有扩展逐条相同。

| 场景 | 结论要点 |
| --- | --- |
| MySQL 传统表格，`orders` 的 `type=ALL`，Extra 含 `Using filesort`，`filtered=10` | 全表扫描、filesort，过滤率偏低 |
| MySQL `orders` 走 `ref`，`users` 走 `eq_ref` | 关联走了索引，没有全表扫描红旗 |
| MySQL `FORMAT=JSON`，`ordering_operation.using_filesort` + 内层 `ALL` | 能看出排序发生在 nested loop 之外，内表仍是全表扫描 |
| PostgreSQL `EXPLAIN ANALYZE`：`Sort Method: external merge Disk`，`Seq Scan on orders` 估计 200 行实际 8000 行 | 磁盘排序、顺序扫描、行数估计偏差 |
| SQLite `SCAN orders` + `SEARCH users USING INTEGER PRIMARY KEY` | `orders` 全表扫描，`users` 主键查找 |

## 限制与后续可改进点

- 不连接真实数据库，也不重放 SQL；只解析你贴进来的计划文本。
- Oracle、SQL Server、达梦等其它方言的计划格式尚未支持。
- MySQL 传统表格没有真正的树形结构，页面按 `id` / `select_type` 分组后按连接顺序列出。
- 不会根据表的真实体积判断「这次数扫描是否可接受」，只按访问类型、行数和 Extra / ANALYZE 信息给提示。
- PostgreSQL 的 JIT、Trigger、并行 worker 细节、以及各种扩展节点类型，可以后续再补。
- 没有把代价折算成时间，也不提供「该建什么索引」的自动建议。

## 许可

MIT。详见 [LICENSE](LICENSE)。
