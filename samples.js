/* fictional EXPLAIN samples for explain-lab */
window.EXPLAIN_SAMPLES = [
  {
    label: "MySQL 全表扫描",
    text: [
      "+----+-------------+--------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+",
      "| id | select_type | table  | partitions | type | possible_keys | key  | key_len | ref  | rows | filtered | Extra                       |",
      "+----+-------------+--------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+",
      "|  1 | SIMPLE      | orders | NULL       | ALL  | NULL          | NULL | NULL    | NULL | 8500 |    10.00 | Using where; Using filesort |",
      "+----+-------------+--------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+"
    ].join("\n")
  },
  {
    label: "MySQL 索引关联",
    text: [
      "+----+-------------+--------+------+---------------+----------+---------+-------------------+------+----------+-------+",
      "| id | select_type | table  | type | possible_keys | key      | key_len | ref               | rows | filtered | Extra |",
      "+----+-------------+--------+------+---------------+----------+---------+-------------------+------+----------+-------+",
      "|  1 | SIMPLE      | orders | ref  | idx_user      | idx_user | 8       | const             |   12 |   100.00 | NULL  |",
      "|  1 | SIMPLE      | users  | eq_ref | PRIMARY     | PRIMARY  | 8       | db.orders.user_id |    1 |   100.00 | NULL  |",
      "+----+-------------+--------+------+---------------+----------+---------+-------------------+------+----------+-------+"
    ].join("\n")
  },
  {
    label: "MySQL JSON",
    text: JSON.stringify({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "14.50" },
        ordering_operation: {
          using_filesort: true,
          nested_loop: [
            { table: { table_name: "orders", access_type: "ALL", rows_examined_per_scan: 8000, filtered: 10, possible_keys: ["idx_status"], cost_info: { read_cost: "12.00" } } },
            { table: { table_name: "users", access_type: "eq_ref", key: "PRIMARY", rows_examined_per_scan: 1, ref: ["orders.user_id"], cost_info: { read_cost: "0.25" } } }
          ]
        }
      }
    }, null, 2)
  },
  {
    label: "MySQL TREE",
    text: [
      "-> Limit: 10 row(s)  (cost=25.5 rows=10) (actual time=1.20..1.25 rows=10 loops=1)",
      "    -> Sort: orders.created_at DESC, limit input to 10 row(s) per chunk  (cost=25.5 rows=800) (actual time=1.18..1.20 rows=10 loops=1)",
      "        -> Nested loop inner join  (cost=20.0 rows=800) (actual time=0.10..0.90 rows=800 loops=1)",
      "            -> Table scan on orders  (cost=12.0 rows=8000) (actual time=0.02..0.40 rows=8000 loops=1)",
      "            -> Index lookup on users using PRIMARY (id=orders.user_id)  (cost=0.25 rows=1) (actual time=0.0004..0.0004 rows=1 loops=800)"
    ].join("\n")
  },
  {
    label: "PostgreSQL ANALYZE",
    text: [
      "                                 QUERY PLAN",
      "-----------------------------------------------------------------------------------",
      " Sort  (cost=35.85..36.10 rows=100 width=136) (actual time=12.214..12.225 rows=5000 loops=1)",
      "   Sort Key: orders.created_at",
      "   Sort Method: external merge  Disk: 2048kB",
      "   ->  Hash Join  (cost=22.15..32.52 rows=100 width=136) (actual time=0.089..8.150 rows=5000 loops=1)",
      "         Hash Cond: (orders.user_id = users.id)",
      "         ->  Seq Scan on orders  (cost=0.00..8.00 rows=200 width=68) (actual time=0.012..2.025 rows=8000 loops=1)",
      "               Filter: (status = 'paid'::text)",
      "               Rows Removed by Filter: 200",
      "         ->  Hash  (cost=16.00..16.00 rows=100 width=68) (actual time=0.068..0.068 rows=100 loops=1)",
      "               Buckets: 1024  Batches: 1  Memory Usage: 14kB",
      "               ->  Seq Scan on users  (cost=0.00..16.00 rows=100 width=68) (actual time=0.008..0.020 rows=100 loops=1)",
      " Planning Time: 0.150 ms",
      " Execution Time: 12.280 ms"
    ].join("\n")
  },
  {
    label: "SQLite QUERY PLAN",
    text: ["QUERY PLAN", "|--SCAN orders", String.fromCharCode(96) + "--SEARCH users USING INTEGER PRIMARY KEY (rowid=?)"].join("\n")
  }
];