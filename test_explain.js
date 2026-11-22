/* node test_explain.js */
"use strict";
var assert = require("assert");
var lab = require("./explain.js");
var failed = 0;
var passed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL  " + name); console.log("        " + (e && e.stack ? e.stack : e)); }
}

function flagsOf(result) {
  var out = [];
  (function walk(nodes) {
    (nodes || []).forEach(function (n) {
      out = out.concat(n.flags || []);
      walk(n.children);
    });
  })(result.roots);
  return out.join(" | ");
}

function titles(result) {
  var out = [];
  (function walk(nodes) {
    (nodes || []).forEach(function (n) { out.push(n.title); walk(n.children); });
  })(result.roots);
  return out;
}

var MYSQL_TABLE = [
  "+----+-------------+--------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+",
  "| id | select_type | table  | partitions | type | possible_keys | key  | key_len | ref  | rows | filtered | Extra                       |",
  "+----+-------------+--------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+",
  "|  1 | SIMPLE      | orders | NULL       | ALL  | NULL          | NULL | NULL    | NULL | 8500 |    10.00 | Using where; Using filesort |",
  "+----+-------------+--------+------------+------+---------------+------+---------+------+------+----------+-----------------------------+"
].join("\n");

var MYSQL_REF = [
  "+----+-------------+--------+------+---------------+----------+---------+------------------+------+----------+-------+",
  "| id | select_type | table  | type | possible_keys | key      | key_len | ref              | rows | filtered | Extra |",
  "+----+-------------+--------+------+---------------+----------+---------+------------------+------+----------+-------+",
  "|  1 | SIMPLE      | orders | ref  | idx_user      | idx_user | 8       | const            |   12 |   100.00 | NULL  |",
  "|  1 | SIMPLE      | users  | eq_ref | PRIMARY     | PRIMARY  | 8       | db.orders.user_id |    1 |   100.00 | NULL  |",
  "+----+-------------+--------+------+---------------+----------+---------+------------------+------+----------+-------+"
].join("\n");

var MYSQL_VERTICAL = [
  "*************************** 1. row ***************************",
  "           id: 1",
  "  select_type: SIMPLE",
  "        table: accounts",
  "         type: ALL",
  "possible_keys: NULL",
  "          key: NULL",
  "      key_len: NULL",
  "          ref: NULL",
  "         rows: 1200",
  "     filtered: 100.00",
  "        Extra: NULL"
].join("\n");

var MYSQL_JSON = JSON.stringify({
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
}, null, 2);

var MYSQL_TREE = [
  "-> Limit: 10 row(s)  (cost=25.5 rows=10) (actual time=1.20..1.25 rows=10 loops=1)",
  "    -> Sort: orders.created_at DESC, limit input to 10 row(s) per chunk  (cost=25.5 rows=800) (actual time=1.18..1.20 rows=10 loops=1)",
  "        -> Nested loop inner join  (cost=20.0 rows=800) (actual time=0.10..0.90 rows=800 loops=1)",
  "            -> Table scan on orders  (cost=12.0 rows=8000) (actual time=0.02..0.40 rows=8000 loops=1)",
  "            -> Index lookup on users using PRIMARY (id=orders.user_id)  (cost=0.25 rows=1) (actual time=0.0004..0.0004 rows=1 loops=800)"
].join("\n");

var PG_TEXT = [
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
  " Execution Time: 12.280 ms",
  "(10 rows)"
].join("\n");

var PG_JSON = JSON.stringify([{
  Plan: {
    "Node Type": "Index Scan",
    "Relation Name": "users",
    "Index Name": "users_pkey",
    "Startup Cost": 0.15,
    "Total Cost": 8.17,
    "Plan Rows": 1,
    "Plan Width": 72,
    "Actual Startup Time": 0.012,
    "Actual Total Time": 0.015,
    "Actual Rows": 1,
    "Actual Loops": 1,
    "Index Cond": "(id = 42)"
  },
  "Planning Time": 0.08,
  "Execution Time": 0.04
}]);

var SQLITE_TREE = [
  "QUERY PLAN",
  "|--SCAN orders",
  String.fromCharCode(96) + "--SEARCH users USING INTEGER PRIMARY KEY (rowid=?)"
].join("\n");

var SQLITE_PIPE = [
  "id|parent|notused|detail",
  "2|0|0|SCAN TABLE orders",
  "3|0|0|SEARCH TABLE users USING INTEGER PRIMARY KEY (rowid=?)"
].join("\n");

console.log("explain-lab tests");

test("empty input fails", function () {
  var r = lab.parseExplain("   ");
  assert.strictEqual(r.ok, false);
  assert.ok(/粘贴/.test(r.error));
});

test("unknown text fails clearly", function () {
  var r = lab.parseExplain("hello world, this is not a plan");
  assert.strictEqual(r.ok, false);
  assert.ok(/无法识别/.test(r.error));
});

test("MySQL table: full scan + filesort", function () {
  var r = lab.parseExplain(MYSQL_TABLE);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "mysql");
  assert.strictEqual(r.format, "table");
  var f = flagsOf(r);
  assert.ok(/全表扫描/.test(f), f);
  assert.ok(/filesort/.test(f), f);
  assert.ok(/过滤率/.test(f), f);
  assert.ok(titles(r).some(function (t) { return /orders/.test(t); }));
  assert.ok(r.summary.fullScans >= 1);
  assert.ok(r.summary.sorts >= 1);
});

test("MySQL table: index join looks clean", function () {
  var r = lab.parseExplain(MYSQL_REF);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "mysql");
  var f = flagsOf(r);
  assert.ok(!/全表扫描/.test(f), f);
  assert.ok(titles(r).some(function (t) { return /eq_ref/.test(t); }));
});

test("MySQL vertical format", function () {
  var r = lab.parseExplain(MYSQL_VERTICAL);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.format, "vertical");
  assert.ok(/全表扫描/.test(flagsOf(r)));
  assert.ok(titles(r).some(function (t) { return /accounts/.test(t); }));
});

test("MySQL FORMAT=JSON with filesort and nested loop", function () {
  var r = lab.parseExplain(MYSQL_JSON);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "mysql");
  assert.strictEqual(r.format, "json");
  assert.ok(titles(r).some(function (t) { return /query_block/.test(t); }));
  assert.ok(titles(r).some(function (t) { return /orders/.test(t); }));
  assert.ok(titles(r).some(function (t) { return /users/.test(t); }));
  var f = flagsOf(r);
  assert.ok(/filesort/.test(f), f);
  assert.ok(/全表扫描/.test(f), f);
  assert.strictEqual(r.summary.cost, 14.5);
});

test("MySQL FORMAT=TREE", function () {
  var r = lab.parseExplain(MYSQL_TREE);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "mysql");
  assert.strictEqual(r.format, "tree");
  var t = titles(r).join(" | ");
  assert.ok(/Table scan on orders/.test(t), t);
  assert.ok(/Index lookup on users/.test(t), t);
  assert.ok(/全表扫描/.test(flagsOf(r)));
  assert.ok(/filesort/.test(flagsOf(r)));
  assert.strictEqual(r.roots[0].actualRows, 10);
});

test("PostgreSQL text ANALYZE with disk sort and estimate drift", function () {
  var r = lab.parseExplain(PG_TEXT);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "postgres");
  assert.strictEqual(r.format, "tree");
  assert.strictEqual(r.summary.executionTime, 12.28);
  assert.strictEqual(r.summary.planningTime, 0.15);
  assert.ok(r.summary.analyze);
  var t = titles(r).join(" | ");
  assert.ok(/Hash Join/.test(t), t);
  assert.ok(/Seq Scan on orders/.test(t), t);
  var f = flagsOf(r);
  assert.ok(/磁盘排序/.test(f), f);
  assert.ok(/顺序扫描/.test(f), f);
  assert.ok(/行数估计偏差/.test(f), f);
  var sort = r.roots[0];
  assert.ok(/Sort/.test(sort.title));
  assert.strictEqual(sort.children.length, 1);
  assert.ok(/Hash Join/.test(sort.children[0].title));
});

test("PostgreSQL FORMAT JSON index scan is clean", function () {
  var r = lab.parseExplain(PG_JSON);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "postgres");
  assert.strictEqual(r.format, "json");
  assert.ok(/Index Scan on users using users_pkey/.test(titles(r)[0]));
  assert.strictEqual(r.summary.executionTime, 0.04);
  assert.ok(!/顺序扫描/.test(flagsOf(r)));
});

test("SQLite QUERY PLAN tree", function () {
  var r = lab.parseExplain(SQLITE_TREE);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "sqlite");
  var t = titles(r).join(" | ");
  assert.ok(/SCAN orders/.test(t), t);
  assert.ok(/SEARCH users/.test(t), t);
  assert.ok(/全表扫描/.test(flagsOf(r)));
});

test("SQLite id|parent pipe table", function () {
  var r = lab.parseExplain(SQLITE_PIPE);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.dialect, "sqlite");
  assert.ok(titles(r).some(function (t) { return /SCAN TABLE orders/.test(t); }));
  assert.ok(titles(r).some(function (t) { return /SEARCH TABLE users/.test(t); }));
});

test("markdown export includes tree and warnings", function () {
  var r = lab.parseExplain(MYSQL_TABLE);
  var md = lab.toMarkdown(r);
  assert.ok(/EXPLAIN 摘要/.test(md));
  assert.ok(/MySQL/.test(md));
  assert.ok(/全表扫描/.test(md));
  assert.ok(/orders/.test(md));
  assert.ok(/未上传/.test(md));
});

test("junk JSON is rejected", function () {
  var r = lab.parseExplain('{"foo": 1}');
  assert.strictEqual(r.ok, false);
  assert.ok(/JSON/.test(r.error));
});

test("mysqlAccessRank order", function () {
  assert.ok(lab.mysqlAccessRank("const") < lab.mysqlAccessRank("ref"));
  assert.ok(lab.mysqlAccessRank("ref") < lab.mysqlAccessRank("ALL"));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);