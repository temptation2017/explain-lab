/* explain-lab UI */
(function () {
  var src = document.getElementById("src");
  var out = document.getElementById("out");
  var toast = document.getElementById("toast");
  var last = null;
  var box = document.getElementById("samples");
  (window.EXPLAIN_SAMPLES || []).forEach(function (s) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = s.label;
    b.addEventListener("click", function () { src.value = s.text; render(); });
    box.appendChild(b);
  });
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function metric(n) {
    var bits = [];
    if (n.cost != null) {
      bits.push("cost=" + ExplainLab.fmtNum(n.costStart != null ? n.costStart : n.cost) + (n.costStart != null ? ".." + ExplainLab.fmtNum(n.cost) : ""));
    }
    if (n.rows != null) bits.push("rows=" + ExplainLab.fmtNum(n.rows));
    if (n.width != null) bits.push("width=" + ExplainLab.fmtNum(n.width));
    if (n.actual != null) bits.push("actual=" + ExplainLab.fmtNum(n.actual, 3) + " ms");
    if (n.actualRows != null) bits.push("actual_rows=" + ExplainLab.fmtNum(n.actualRows));
    if (n.loops != null) bits.push("loops=" + ExplainLab.fmtNum(n.loops));
    return bits.join("  ");
  }
  function renderNode(n) {
    var flags = (n.flags || []).map(function (f) { return "<span>" + esc(f) + "</span>"; }).join("");
    var details = (n.details || []).slice(0, 8).map(function (d) {
      return "<div>" + esc(d.key) + ": " + esc(d.value) + "</div>";
    }).join("");
    var kids = (n.children || []).map(renderNode).join("");
    var meta = metric(n);
    return "<div class=\"node " + esc(n.severity || "ok") + "\">" +
      "<div class=\"node-title\">" + esc(n.title) + "</div>" +
      (flags ? "<div class=\"node-flags\">" + flags + "</div>" : "") +
      (meta ? "<div class=\"node-meta\">" + esc(meta) + "</div>" : "") +
      (details ? "<div class=\"node-details\">" + details + "</div>" : "") +
      (kids ? "<div class=\"kids\">" + kids + "</div>" : "") +
      "</div>";
  }
  function render() {
    toast.hidden = true;
    var text = src.value;
    if (!text.trim()) {
      last = null;
      out.innerHTML = "<p class=\"empty\">左侧贴入计划，或点一个示例。</p>";
      return;
    }
    var r = ExplainLab.parseExplain(text);
    last = r;
    if (!r.ok) {
      out.innerHTML = "<p class=\"error\">" + esc(r.error) + "</p>";
      return;
    }
    var s = r.summary;
    var chips = [];
    chips.push("<span class=\"chip info\">" + esc(ExplainLab.dialectLabel(s.dialect)) + " · " + esc(ExplainLab.formatLabel(s.format)) + "</span>");
    chips.push("<span class=\"chip\">节点 " + s.nodes + "</span>");
    if (s.cost != null) chips.push("<span class=\"chip\">代价 " + esc(ExplainLab.fmtNum(s.cost)) + "</span>");
    if (s.executionTime != null) chips.push("<span class=\"chip info\">执行 " + esc(ExplainLab.fmtNum(s.executionTime, 3)) + " ms</span>");
    if (s.planningTime != null) chips.push("<span class=\"chip\">规划 " + esc(ExplainLab.fmtNum(s.planningTime, 3)) + " ms</span>");
    if (s.fullScans) chips.push("<span class=\"chip " + (s.worst === "bad" ? "bad" : "warn") + "\">扫描 " + s.fullScans + "</span>");
    if (s.sorts) chips.push("<span class=\"chip warn\">排序风险 " + s.sorts + "</span>");
    if (!s.warnings) chips.push("<span class=\"chip ok\">没有明显红旗</span>");
    else chips.push("<span class=\"chip " + (s.worst === "bad" ? "bad" : "warn") + "\">提示 " + s.warnings + "</span>");
    var warns = "";
    if (r.warnings.length) {
      warns = "<ul class=\"warn-list\">" + r.warnings.map(function (w) {
        return "<li class=\"" + w.level + "\"><span class=\"flag\">" + esc(w.flag) + "</span> — " + esc(w.title) + "</li>";
      }).join("") + "</ul>";
    }
    out.innerHTML = "<div class=\"chips\">" + chips.join("") + "</div>" + warns + "<div class=\"tree\">" + r.roots.map(renderNode).join("") + "</div>";
  }
  src.addEventListener("input", render);
  document.getElementById("btn-clear").addEventListener("click", function () { src.value = ""; render(); });
  document.getElementById("btn-copy").addEventListener("click", function () {
    var md = ExplainLab.toMarkdown(last || ExplainLab.parseExplain(src.value));
    function ok() { toast.hidden = false; setTimeout(function () { toast.hidden = true; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(ok).catch(function () { window.prompt("复制下面的摘要", md); });
    } else {
      window.prompt("复制下面的摘要", md);
    }
  });
})();