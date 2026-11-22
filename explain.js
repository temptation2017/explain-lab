/* explain-lab — parse EXPLAIN output in the browser or Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExplainLab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MYSQL_ACCESS = [
    "system", "const", "eq_ref", "ref", "fulltext", "ref_or_null",
    "index_merge", "unique_subquery", "index_subquery", "range", "index", "ALL"
  ];

  function mysqlAccessRank(type) {
    var i = MYSQL_ACCESS.indexOf(String(type || "").trim());
    return i < 0 ? -1 : i;
  }

  function accessSeverity(type, rows) {
    var t = String(type || "");
    var n = rows == null ? 0 : Number(rows);
    if (t === "ALL") return n >= 1000 ? "bad" : "warn";
    if (t === "index") return n >= 1000 ? "warn" : "ok";
    return "ok";
  }

  function isBlank(s) {
    return s == null || String(s).trim() === "" || /^null$/i.test(String(s).trim());
  }

  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function fmtNum(v, digits) {
    if (v == null || !Number.isFinite(Number(v))) return "-";
    var n = Number(v);
    if (Math.abs(n) >= 1000) return String(Math.round(n));
    if (Number.isInteger(n)) return String(n);
    return String(Number(n.toFixed(digits == null ? 2 : digits)));
  }

  function node(partial) {
    return Object.assign({
      title: "", kind: "", dialect: "", severity: "ok",
      costStart: null, cost: null, rows: null, width: null,
      actualStart: null, actual: null, actualRows: null, loops: null,
      details: [], flags: [], children: []
    }, partial || {});
  }

  function addFlag(n, flag) {
    if (flag && n.flags.indexOf(flag) < 0) n.flags.push(flag);
  }

  function bumpSeverity(n, level) {
    var order = { ok: 0, warn: 1, bad: 2 };
    if ((order[level] || 0) > (order[n.severity] || 0)) n.severity = level;
  }

  function stripNoise(text) {
    return String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  }

  function tryJson(text) {
    var s = text.trim();
    if (s.charAt(0) !== "{" && s.charAt(0) !== "[") return null;
    try { return JSON.parse(s); } catch (e1) {}
    var start = s.search(/[\[{]/);
    var end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch (e2) {}
    }
    return null;
  }

  function looksLikePgJson(obj) {
    if (Array.isArray(obj)) return obj.length > 0 && looksLikePgJson(obj[0]);
    return !!(obj && (obj.Plan || obj["Node Type"] || (obj.Plans && obj["Total Cost"] != null)));
  }

  function looksLikeMysqlJson(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (obj.query_block) return true;
    if (Array.isArray(obj)) return obj.some(looksLikeMysqlJson);
    return !!(obj.table || obj.nested_loop || obj.ordering_operation || obj.grouping_operation);
  }

  function annotatePg(n) {
    var kind = (n.kind || "").toLowerCase();
    if (/seq scan/.test(kind)) {
      addFlag(n, "顺序扫描");
      bumpSeverity(n, (n.actualRows != null ? n.actualRows : n.rows) >= 1000 ? "bad" : "warn");
    }
    n.details.forEach(function (d) {
      if (/sort method/i.test(d.key) && /disk|external/i.test(d.value)) {
        addFlag(n, "磁盘排序");
        bumpSeverity(n, "bad");
      }
    });
    if (n.rows != null && n.actualRows != null && n.rows > 0) {
      var ratio = n.actualRows / n.rows;
      if (ratio >= 10 || ratio <= 0.1) {
        var label = ratio >= 1 ? Math.round(ratio) + "x" : fmtNum(ratio, 2) + "x";
        addFlag(n, "行数估计偏差 " + label);
        bumpSeverity(n, ratio >= 100 || ratio <= 0.01 ? "bad" : "warn");
      }
    }
  }

  function pgNodeFromJson(plan) {
    if (!plan || typeof plan !== "object") return null;
    var typ = plan["Node Type"] || "Plan";
    var rel = plan["Relation Name"] || plan["CTE Name"] || "";
    var alias = plan["Alias"] && plan["Alias"] !== rel ? plan["Alias"] : "";
    var using = plan["Index Name"] ? " using " + plan["Index Name"] : "";
    var n = node({
      title: (typ + (rel ? " on " + rel : "") + (alias ? " " + alias : "") + using).trim(),
      kind: typ, dialect: "postgres",
      costStart: num(plan["Startup Cost"]), cost: num(plan["Total Cost"]),
      rows: num(plan["Plan Rows"]), width: num(plan["Plan Width"]),
      actualStart: num(plan["Actual Startup Time"]), actual: num(plan["Actual Total Time"]),
      actualRows: num(plan["Actual Rows"]), loops: num(plan["Actual Loops"])
    });
    var skip = {
      "Node Type": 1, "Plans": 1, "Startup Cost": 1, "Total Cost": 1,
      "Plan Rows": 1, "Plan Width": 1, "Actual Startup Time": 1,
      "Actual Total Time": 1, "Actual Rows": 1, "Actual Loops": 1,
      "Parent Relationship": 1, "Relation Name": 1, "Alias": 1, "Schema": 1, "Output": 1
    };
    Object.keys(plan).forEach(function (k) {
      if (skip[k]) return;
      var v = plan[k];
      if (v == null || typeof v === "object") return;
      n.details.push({ key: k, value: String(v) });
    });
    if (Array.isArray(plan.Output)) n.details.push({ key: "Output", value: plan.Output.join(", ") });
    annotatePg(n);
    (plan.Plans || []).forEach(function (ch) {
      var c = pgNodeFromJson(ch);
      if (c) n.children.push(c);
    });
    return n;
  }

  function parsePgJson(obj, meta) {
    var wrap = Array.isArray(obj) ? obj[0] : obj;
    var plan = wrap.Plan || wrap;
    if (wrap["Planning Time"] != null) meta.planningTime = num(wrap["Planning Time"]);
    if (wrap["Execution Time"] != null) meta.executionTime = num(wrap["Execution Time"]);
    if (wrap["Planning Time"] != null || wrap["Execution Time"] != null) meta.analyze = true;
    var root = pgNodeFromJson(plan);
    return root ? [root] : [];
  }

  function mysqlAccessTitle(table) {
    var name = table.table_name || table.table || "table";
    var typ = table.access_type || table.type || "";
    var key = table.key || "";
    var title = name + (typ ? " (" + typ + ")" : "");
    if (key && !isBlank(key)) title += " key=" + key;
    return title;
  }

  function mysqlTableNode(table) {
    var typ = table.access_type || table.type || "";
    var rows = num(table.rows_examined_per_scan || table.rows);
    var n = node({
      title: mysqlAccessTitle(table), kind: typ || "table", dialect: "mysql",
      cost: num(table.cost_info && (table.cost_info.read_cost || table.cost_info.query_cost || table.cost_info.eval_cost)),
      rows: rows, severity: accessSeverity(typ, rows)
    });
    if (typ === "ALL") { addFlag(n, "全表扫描"); addFlag(n, "未使用索引"); }
    if (typ === "index") addFlag(n, "全索引扫描");
    if (isBlank(table.key) && typ && typ !== "system" && typ !== "const" && typ !== "ALL") addFlag(n, "未使用索引");
    var pairs = [
      ["access_type", typ],
      ["possible_keys", Array.isArray(table.possible_keys) ? table.possible_keys.join(", ") : table.possible_keys],
      ["key", table.key],
      ["key_length", table.key_length],
      ["ref", Array.isArray(table.ref) ? table.ref.join(", ") : table.ref],
      ["rows", table.rows_examined_per_scan || table.rows],
      ["filtered", table.filtered],
      ["using_index", table.using_index],
      ["using_join_buffer", table.using_join_buffer]
    ];
    pairs.forEach(function (p) {
      if (!isBlank(p[1]) && p[1] !== false) n.details.push({ key: p[0], value: String(p[1]) });
    });
    if (table.cost_info) {
      Object.keys(table.cost_info).forEach(function (k) {
        n.details.push({ key: k, value: String(table.cost_info[k]) });
      });
    }
    if (table.attached_condition) n.details.push({ key: "condition", value: String(table.attached_condition) });
    if (table.using_join_buffer) { addFlag(n, "Join Buffer"); bumpSeverity(n, "warn"); }
    return n;
  }

  function mysqlBlockChildren(obj) {
    var out = [];
    if (!obj || typeof obj !== "object") return out;
    function wrapOp(key, title, kind) {
      if (!obj[key]) return;
      var block = obj[key];
      var n = node({ title: title, kind: kind, dialect: "mysql" });
      if (block.using_filesort) { n.title += " (filesort)"; addFlag(n, "filesort"); bumpSeverity(n, "warn"); }
      if (block.using_temporary_table) { addFlag(n, "临时表"); bumpSeverity(n, "warn"); }
      n.children = mysqlBlockChildren(block);
      out.push(n);
    }
    wrapOp("ordering_operation", "ordering", "ordering");
    wrapOp("grouping_operation", "grouping", "grouping");
    wrapOp("duplicates_removal", "duplicates_removal", "distinct");
    wrapOp("union_result", "union_result", "union");
    if (obj.nested_loop) {
      var nn = node({ title: "nested_loop", kind: "nested_loop", dialect: "mysql" });
      (obj.nested_loop || []).forEach(function (item) {
        nn.children = nn.children.concat(mysqlBlockChildren(item));
      });
      out.push(nn);
    }
    if (obj.table) out.push(mysqlTableNode(obj.table));
    ["attached_subqueries", "optimized_away_subqueries", "select_list_subqueries"].forEach(function (k) {
      if (!obj[k]) return;
      var sn = node({ title: k, kind: "subquery", dialect: "mysql" });
      (Array.isArray(obj[k]) ? obj[k] : [obj[k]]).forEach(function (sub) {
        sn.children = sn.children.concat(walkMysqlJson(sub));
      });
      out.push(sn);
    });
    return out;
  }

  function walkMysqlJson(obj) {
    if (!obj || typeof obj !== "object") return [];
    if (Array.isArray(obj)) {
      var acc = [];
      obj.forEach(function (x) { acc = acc.concat(walkMysqlJson(x)); });
      return acc;
    }
    if (obj.query_block) {
      var qb = obj.query_block;
      var qn = node({
        title: "query_block" + (qb.select_id != null ? " #" + qb.select_id : ""),
        kind: "query_block", dialect: "mysql",
        cost: num(qb.cost_info && qb.cost_info.query_cost)
      });
      if (qb.cost_info && qb.cost_info.query_cost != null) {
        qn.details.push({ key: "query_cost", value: String(qb.cost_info.query_cost) });
      }
      qn.children = mysqlBlockChildren(qb);
      return [qn];
    }
    return mysqlBlockChildren(obj);
  }

  var RE_PG_NODE = /^(\s*)(?:->\s+)?(.+?)\s+\(cost=([0-9.]+)\.\.([0-9.]+)\s+rows=([0-9.]+)\s+width=([0-9.]+)\)(?:\s+\(actual time=([0-9.]+)\.\.([0-9.]+)\s+rows=([0-9.]+)\s+loops=([0-9.]+)\))?(?:\s+\(never executed\))?$/;
  var RE_MYSQL_TREE = /^(\s*)(?:->\s+)?(.+?)\s+\(cost=([0-9.]+)\s+rows=([0-9.]+)\)(?:\s+\(actual time=([0-9.]+)\.\.([0-9.]+)\s+rows=([0-9.]+)\s+loops=([0-9.]+)\))?$/;
  var RE_ARROW = /^(\s*)->\s+(.*)$/;
  var RE_PSQL_COUNT = /^\(\d+\s+rows?\)$/;
  var RE_HEADER_RULE = /^[=\-]+$/;

  function annotateMysqlTree(n) {
    var t = n.title || "";
    if (/Table scan/i.test(t)) {
      addFlag(n, "全表扫描");
      bumpSeverity(n, (n.actualRows != null ? n.actualRows : n.rows) >= 1000 ? "bad" : "warn");
    }
    if (/filesort|Sort:/i.test(t)) { addFlag(n, "filesort"); bumpSeverity(n, "warn"); }
    if (/temporary/i.test(t)) { addFlag(n, "临时表"); bumpSeverity(n, "warn"); }
  }

  function lastWithIndentLess(items, indent) {
    for (var i = items.length - 1; i >= 0; i--) {
      if (items[i].indent < indent) return items[i];
    }
    return items[items.length - 1] || null;
  }

  function stackTrees(items) {
    var roots = [];
    var stack = [];
    items.forEach(function (it) {
      while (stack.length && stack[stack.length - 1].indent >= it.indent) stack.pop();
      if (stack.length === 0) roots.push(it.node);
      else stack[stack.length - 1].node.children.push(it.node);
      stack.push(it);
    });
    return roots;
  }

  function parseArrowTree(text, meta) {
    var dialectGuess = "auto";
    var lines = [];
    text.split("\n").forEach(function (line) {
      var t = line.replace(/\s+$/, "");
      if (!t.trim()) return;
      if (/^\s*QUERY PLAN\s*$/i.test(t)) { dialectGuess = "postgres"; return; }
      if (RE_HEADER_RULE.test(t.trim())) return;
      if (RE_PSQL_COUNT.test(t.trim())) return;
      var plan = t.trim().match(/^Planning(?: Time)?:\s*([0-9.]+)\s*ms$/i);
      var exec = t.trim().match(/^Execution(?: Time)?:\s*([0-9.]+)\s*ms$/i);
      if (plan) { meta.planningTime = num(plan[1]); meta.analyze = true; dialectGuess = "postgres"; return; }
      if (exec) { meta.executionTime = num(exec[1]); meta.analyze = true; dialectGuess = "postgres"; return; }
      if (/^(JIT:|Settings:|Trigger)/i.test(t.trim())) return;
      lines.push(t);
    });
    var items = [];
    lines.forEach(function (line) {
      var pg = line.match(RE_PG_NODE);
      if (pg) {
        dialectGuess = "postgres";
        var title = pg[2].replace(/^->\s+/, "").trim();
        var n = node({
          title: title, kind: title.replace(/\s+on\s+.*$/, "").trim(), dialect: "postgres",
          costStart: num(pg[3]), cost: num(pg[4]), rows: num(pg[5]), width: num(pg[6]),
          actualStart: num(pg[7]), actual: num(pg[8]), actualRows: num(pg[9]), loops: num(pg[10])
        });
        annotatePg(n);
        items.push({ indent: pg[1].length, node: n });
        return;
      }
      var my = line.match(RE_MYSQL_TREE);
      var mysqlTreeLine = my && dialectGuess !== "postgres" &&
        (line.indexOf("->") >= 0 || /Table scan|Index lookup|Index scan|Filter:|Limit:|Sort:|Nested loop/i.test(line));
      if (mysqlTreeLine) {
        dialectGuess = "mysql";
        var mt = my[2].replace(/^->\s+/, "").trim();
        var mn = node({
          title: mt, kind: mt.split(":")[0].split(" on ")[0].trim(), dialect: "mysql",
          cost: num(my[3]), rows: num(my[4]),
          actualStart: num(my[5]), actual: num(my[6]), actualRows: num(my[7]), loops: num(my[8])
        });
        annotateMysqlTree(mn);
        items.push({ indent: my[1].length, node: mn });
        return;
      }
      var arrow = line.match(RE_ARROW);
      if (arrow) {
        var rest = arrow[2].trim();
        var n2 = node({ title: rest, kind: rest.split("(")[0].trim(), dialect: dialectGuess === "postgres" ? "postgres" : "mysql" });
        if (n2.dialect === "mysql") annotateMysqlTree(n2);
        items.push({ indent: arrow[1].length, node: n2 });
        return;
      }
      var mIndent = line.match(/^(\s*)(.*)$/);
      var indent = mIndent ? mIndent[1].length : 0;
      var body = mIndent ? mIndent[2] : line;
      if (items.length === 0) {
        items.push({ indent: indent, node: node({ title: body.trim(), kind: "label", dialect: dialectGuess === "auto" ? "" : dialectGuess }) });
        return;
      }
      var owner = lastWithIndentLess(items, indent);
      if (owner) {
        var kvline = body.match(/^([^:]+):\s*(.*)$/);
        if (kvline) owner.node.details.push({ key: kvline[1].trim(), value: kvline[2].trim() });
        else owner.node.details.push({ key: "info", value: body.trim() });
        if (owner.node.dialect === "postgres") annotatePg(owner.node);
        if (owner.node.dialect === "mysql") annotateMysqlTree(owner.node);
      }
    });
    meta._dialectGuess = dialectGuess;
    return stackTrees(items);
  }

  function parseMysqlVertical(text) {
    var rows = [];
    text.split(/\*{5,}/).forEach(function (chunk) {
      var obj = {};
      var found = false;
      chunk.split("\n").forEach(function (line) {
        var m = line.match(/^\s*([A-Za-z0-9_]+):\s*(.*)$/);
        if (!m) return;
        obj[m[1].toLowerCase()] = m[2].trim();
        found = true;
      });
      if (found && (obj.id != null || obj.select_type != null || obj.table != null || obj.type != null)) rows.push(obj);
    });
    return rows;
  }

  function splitRow(line) {
    if (line.indexOf("\t") >= 0) return line.split("\t").map(function (s) { return s.trim(); });
    return line.trim().split(/\s{2,}/);
  }

  function rowFromParts(headers, parts) {
    var obj = {};
    headers.forEach(function (h, i) {
      obj[String(h).toLowerCase()] = parts[i] == null ? "" : String(parts[i]).trim();
    });
    return obj;
  }

  function parseMysqlTable(text) {
    var raw = text.split("\n").map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim(); });
    var headerIdx = -1;
    var headers = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      if (/^\+[-+]+/.test(line)) continue;
      if (line.indexOf("|") >= 0 && /select_type|\btype\b/i.test(line) && /table/i.test(line)) {
        headers = line.split("|").map(function (c) { return c.trim(); }).filter(Boolean);
        headerIdx = i;
        break;
      }
    }
    if (headerIdx >= 0) {
      var rows = [];
      for (var r = headerIdx + 1; r < raw.length; r++) {
        if (/^\+[-+]+/.test(raw[r])) continue;
        if (raw[r].indexOf("|") < 0) {
          if (/^\(\d+\s+rows?\)/.test(raw[r].trim())) break;
          continue;
        }
        var cells = raw[r].split("|").map(function (c) { return c.trim(); });
        if (cells.length && cells[0] === "") cells.shift();
        if (cells.length && cells[cells.length - 1] === "") cells.pop();
        if (cells.length < 3) continue;
        rows.push(rowFromParts(headers, cells));
      }
      return rows;
    }
    for (var j = 0; j < Math.min(raw.length, 8); j++) {
      var cols = splitRow(raw[j]);
      var lower = cols.map(function (c) { return c.toLowerCase(); });
      if (lower.indexOf("select_type") >= 0 && lower.indexOf("table") >= 0) {
        headers = cols;
        headerIdx = j;
        break;
      }
    }
    if (headerIdx < 0) return [];
    var trows = [];
    for (var k = headerIdx + 1; k < raw.length; k++) {
      if (/^\+[-+]+/.test(raw[k]) || /^[-=]+$/.test(raw[k].trim())) continue;
      if (/^\(\d+\s+rows?\)/.test(raw[k].trim())) break;
      var parts = splitRow(raw[k]);
      if (parts.length < 3) continue;
      trows.push(rowFromParts(headers, parts));
    }
    return trows;
  }

  function mysqlRowsToNodes(rows) {
    var groups = [];
    var current = null;
    rows.forEach(function (row) {
      var typ = row.type || row.access_type || "";
      var table = row.table || "";
      var extra = row.extra || "";
      var rowsN = num(row.rows);
      var n = node({
        title: (table || "(no table)") + (typ ? " (" + typ + ")" : ""),
        kind: typ || "row", dialect: "mysql", rows: rowsN,
        severity: accessSeverity(typ, rowsN)
      });
      ["id", "select_type", "table", "partitions", "type", "possible_keys", "key", "key_len", "key_length", "ref", "rows", "filtered", "extra"].forEach(function (k) {
        if (!isBlank(row[k])) n.details.push({ key: k, value: String(row[k]) });
      });
      if (typ === "ALL") addFlag(n, "全表扫描");
      if (typ === "index") addFlag(n, "全索引扫描");
      if (isBlank(row.key) && typ && typ !== "system" && typ !== "const") addFlag(n, "未使用索引");
      extra.split(/;|,/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (part) {
        if (/using filesort/i.test(part)) { addFlag(n, "filesort"); bumpSeverity(n, "warn"); }
        if (/using temporary/i.test(part)) { addFlag(n, "临时表"); bumpSeverity(n, "warn"); }
        if (/join buffer/i.test(part)) { addFlag(n, "Join Buffer"); bumpSeverity(n, "warn"); }
      });
      var fil = num(row.filtered);
      if (fil != null && fil <= 20 && rowsN != null && rowsN >= 100) {
        addFlag(n, "过滤率 " + fmtNum(fil, 1) + "%");
        bumpSeverity(n, "warn");
      }
      if (/dependent subquery/i.test(row.select_type || "")) { addFlag(n, "相关子查询"); bumpSeverity(n, "warn"); }
      if (/uncacheable/i.test(row.select_type || "")) { addFlag(n, "不可缓存子查询"); bumpSeverity(n, "warn"); }
      var id = row.id || "";
      if (!current || current.id !== id) {
        current = node({
          title: "id " + (id || "?") + (row.select_type ? " · " + row.select_type : ""),
          kind: row.select_type || "select", dialect: "mysql"
        });
        current.id = id;
        groups.push(current);
      }
      current.children.push(n);
    });
    return groups;
  }

  function sqliteNode(detail) {
    var n = node({ title: detail, kind: detail.split(" ")[0], dialect: "sqlite" });
    if (/\bSCAN\b/i.test(detail) && !/USING INDEX|USING INTEGER PRIMARY KEY|USING COVERING/i.test(detail)) {
      addFlag(n, "全表扫描");
      bumpSeverity(n, "warn");
    }
    if (/SEARCH/i.test(detail)) addFlag(n, "索引查找");
    return n;
  }

  function stripSqlitePrefix(rest) {
    var prefixes = ["|--", String.fromCharCode(96) + "--", "+--", "|-- ", "├──", "└──", "├─", "└─"];
    for (var i = 0; i < prefixes.length; i++) {
      if (rest.indexOf(prefixes[i]) === 0) return rest.slice(prefixes[i].length).trim();
    }
    return null;
  }

  function parseSqlite(text) {
    var raw = text.split("\n").map(function (l) { return l.replace(/\s+$/, ""); });
    var treeItems = [];
    var idRows = [];
    raw.forEach(function (line) {
      if (!line.trim() || /^QUERY PLAN$/i.test(line.trim()) || RE_HEADER_RULE.test(line.trim())) return;
      if (/^\s*id\s+parent\b/i.test(line) || /^\s*addr\s+opcode\b/i.test(line)) return;
      var idm = line.match(/^\s*(\d+)\s*[|]\s*(\d+)\s*[|]\s*(\d+)\s*[|]\s*(.+)$/) ||
                line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (idm && line.indexOf("--") < 0) {
        idRows.push({ id: idm[1], parent: idm[2], detail: idm[4].trim() });
        return;
      }
      var lead = line.match(/^(\s*)(.*)$/);
      if (!lead) return;
      var body = stripSqlitePrefix(lead[2]);
      if (body) treeItems.push({ indent: lead[1].length, node: sqliteNode(body) });
    });
    if (idRows.length) {
      var map = {};
      var roots = [];
      idRows.forEach(function (r) { map[r.id] = sqliteNode(r.detail); });
      idRows.forEach(function (r) {
        if (r.parent && r.parent !== "0" && map[r.parent]) map[r.parent].children.push(map[r.id]);
        else roots.push(map[r.id]);
      });
      return roots;
    }
    return stackTrees(treeItems);
  }

  function looksLikeSqlite(text) {
    if (/EXPLAIN QUERY PLAN/i.test(text)) return true;
    if (/^\s*id\s+parent\s+notused\s+detail\b/im.test(text)) return true;
    if (/^\s*\d+\|\d+\|\d+\|(SCAN|SEARCH)\b/m.test(text)) return true;
    var tickDash = String.fromCharCode(96) + "--";
    if (text.split("\n").some(function (ln) {
      var s = ln.trim();
      return (s.indexOf("|--") === 0 || s.indexOf(tickDash) === 0) && /\b(SCAN|SEARCH)\b/.test(s);
    })) return true;
    if (/\bSEARCH\b.+\bUSING\b/i.test(text) && /\bSCAN\b/i.test(text) && /QUERY PLAN/i.test(text)) return true;
    return false;
  }

  function looksLikeMysqlTable(text) {
    if (/\bselect_type\b/i.test(text) && /\btable\b/i.test(text) && /\btype\b/i.test(text)) return true;
    if (/\*{5,}/.test(text) && /select_type:/i.test(text)) return true;
    return false;
  }

  function looksLikeArrowTree(text) {
    if (/\(cost=[0-9.]+\.\.[0-9.]+\s+rows=/.test(text)) return true;
    if (/^\s*->\s+/m.test(text) && /\(cost=[0-9.]+\s+rows=/.test(text)) return true;
    if (/^\s*QUERY PLAN\s*$/m.test(text) && /\(cost=/.test(text)) return true;
    return false;
  }

  function walk(nodes, fn) {
    (nodes || []).forEach(function (n) { fn(n); walk(n.children, fn); });
  }

  function collectWarnings(roots, warnings) {
    walk(roots, function (n) {
      n.flags.forEach(function (f) {
        if (n.severity === "ok") return;
        warnings.push({ level: n.severity === "bad" ? "bad" : "warn", title: n.title, flag: f });
      });
    });
  }

  function summarize(roots, meta, warnings, dialect, format) {
    var count = 0, worst = "ok", fullScans = 0, sorts = 0;
    walk(roots, function (n) {
      count++;
      if (n.severity === "bad") worst = "bad";
      else if (n.severity === "warn" && worst !== "bad") worst = "warn";
      if (n.flags.some(function (f) { return /全表扫描|顺序扫描/.test(f); })) fullScans++;
      if (n.flags.some(function (f) { return /filesort|磁盘排序/.test(f); })) sorts++;
    });
    var rootCost = roots.length && roots[0].cost != null ? roots[0].cost : null;
    var rootRows = roots.length === 1 ? (roots[0].actualRows != null ? roots[0].actualRows : roots[0].rows) : null;
    return {
      dialect: dialect, format: format, nodes: count, worst: worst,
      fullScans: fullScans, sorts: sorts, warnings: warnings.length, cost: rootCost, rows: rootRows,
      planningTime: meta.planningTime != null ? meta.planningTime : null,
      executionTime: meta.executionTime != null ? meta.executionTime : null,
      analyze: !!meta.analyze
    };
  }

  function dialectLabel(d) {
    return { mysql: "MySQL", postgres: "PostgreSQL", sqlite: "SQLite", unknown: "未知" }[d] || d;
  }

  function formatLabel(f) {
    return { json: "JSON", table: "传统表格", vertical: "竖排", tree: "TREE / 文本树", text: "文本", queryplan: "QUERY PLAN" }[f] || f;
  }

  function toMarkdown(result) {
    if (!result || !result.ok) return "无法解析这段 EXPLAIN。\n" + ((result && result.error) || "");
    var s = result.summary;
    var out = [];
    out.push("# EXPLAIN 摘要");
    out.push("");
    out.push("- 方言：" + dialectLabel(s.dialect) + "（" + formatLabel(s.format) + "）");
    if (s.cost != null) out.push("- 根节点代价：" + fmtNum(s.cost));
    if (s.rows != null) out.push("- 估计/实际行数：" + fmtNum(s.rows));
    if (s.planningTime != null) out.push("- Planning Time：" + fmtNum(s.planningTime, 3) + " ms");
    if (s.executionTime != null) out.push("- Execution Time：" + fmtNum(s.executionTime, 3) + " ms");
    out.push("- 节点数：" + s.nodes);
    out.push("- 全表/顺序扫描：" + s.fullScans + "，排序风险：" + s.sorts);
    out.push("");
    if (result.warnings.length) {
      out.push("## 值得注意");
      result.warnings.forEach(function (w) {
        out.push("- " + (w.level === "bad" ? "【严重】" : "【注意】") + " " + w.flag + " — " + w.title);
      });
      out.push("");
    } else {
      out.push("没有明显的全表扫描、filesort 或行数估计偏差。");
      out.push("");
    }
    out.push("## 计划树");
    function dump(n, pad) {
      var bits = [n.title];
      if (n.cost != null) bits.push("cost=" + fmtNum(n.cost));
      if (n.rows != null) bits.push("rows=" + fmtNum(n.rows));
      if (n.actual != null) bits.push("actual=" + fmtNum(n.actual, 3) + " ms");
      if (n.actualRows != null) bits.push("actual_rows=" + fmtNum(n.actualRows));
      if (n.flags.length) bits.push("[" + n.flags.join(", ") + "]");
      out.push(pad + "- " + bits.join(" · "));
      (n.children || []).forEach(function (c) { dump(c, pad + "  "); });
    }
    (result.roots || []).forEach(function (r) { dump(r, ""); });
    out.push("");
    out.push("由 explain-lab 在本地生成，未上传原文。");
    return out.join("\n");
  }

  function parseExplain(text) {
    var src = stripNoise(text);
    if (!src.trim()) return { ok: false, error: "请粘贴 EXPLAIN / EXPLAIN ANALYZE 的输出。" };
    var warnings = [];
    var meta = {};
    var roots = [];
    var dialect = "unknown";
    var format = "text";
    var json = tryJson(src);
    if (json) {
      if (looksLikePgJson(json)) {
        dialect = "postgres"; format = "json"; roots = parsePgJson(json, meta);
      } else if (looksLikeMysqlJson(json)) {
        dialect = "mysql"; format = "json"; roots = walkMysqlJson(json);
      } else {
        return { ok: false, error: "这是 JSON，但不是常见的 MySQL 或 PostgreSQL EXPLAIN FORMAT=JSON。" };
      }
    } else if (looksLikeMysqlTable(src)) {
      dialect = "mysql";
      var vertical = /\*{5,}/.test(src) && /select_type:/i.test(src);
      var rows = vertical ? parseMysqlVertical(src) : parseMysqlTable(src);
      format = vertical ? "vertical" : "table";
      if (!rows.length) return { ok: false, error: "认出是 MySQL 表格或竖排格式，但没有解析到数据行。请连表头一起复制。" };
      roots = mysqlRowsToNodes(rows);
    } else if (looksLikeArrowTree(src)) {
      roots = parseArrowTree(src, meta);
      dialect = "postgres";
      format = "tree";
      if (/\(cost=[0-9.]+\.\.[0-9.]+\s+rows=/.test(src)) dialect = "postgres";
      else if (/\(cost=[0-9.]+\s+rows=/.test(src) && !/\(cost=[0-9.]+\.\./.test(src)) dialect = "mysql";
      else if (meta._dialectGuess && meta._dialectGuess !== "auto") dialect = meta._dialectGuess;
    } else if (looksLikeSqlite(src)) {
      dialect = "sqlite"; format = "queryplan"; roots = parseSqlite(src);
    } else {
      return { ok: false, error: "无法识别格式。支持：MySQL 传统表格 / 竖排 / FORMAT=JSON / FORMAT=TREE，PostgreSQL 文本或 FORMAT JSON，以及 SQLite EXPLAIN QUERY PLAN。" };
    }
    if (!roots || !roots.length) return { ok: false, error: "解析完成，但没有得到任何计划节点。" };
    collectWarnings(roots, warnings);
    return { ok: true, dialect: dialect, format: format, roots: roots, warnings: warnings, summary: summarize(roots, meta, warnings, dialect, format), meta: meta };
  }

  return {
    parseExplain: parseExplain,
    toMarkdown: toMarkdown,
    mysqlAccessRank: mysqlAccessRank,
    fmtNum: fmtNum,
    dialectLabel: dialectLabel,
    formatLabel: formatLabel
  };
});
