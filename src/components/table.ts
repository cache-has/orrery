/**
 * Table component.
 *
 * Renders a data table with server-rendered rows and inline client-side
 * interactivity for sorting, filtering, pagination, and CSV export.
 */

import type { ComponentNode, PropertyNode, ColumnDef } from "../parser/ast.js";
import type { ComponentRenderer, ComponentRenderData } from "./types.js";
import { formatValue, parseFormatType, type FormatType, type FormatOptions } from "./format.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

function getBoolProp(component: ComponentNode, key: string): boolean | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "boolean") return prop.value.value;
  if (prop.value.kind === "ident") return prop.value.name === "true";
  return undefined;
}

function getNumberProp(component: ComponentNode, key: string): number | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "number") return prop.value.value;
  return undefined;
}

/** Extract column definition config from the AST ColumnsBlock. */
interface ColumnConfig {
  format: FormatType;
  formatOpts: FormatOptions;
  label?: string;
  align?: "left" | "center" | "right";
}

function getColumnConfig(colDef: ColumnDef): ColumnConfig {
  const config: ColumnConfig = { format: "raw", formatOpts: {} };

  for (const prop of colDef.properties) {
    switch (prop.key) {
      case "format":
        config.format = parseFormatType(
          prop.value.kind === "string" ? prop.value.value :
          prop.value.kind === "ident" ? prop.value.name : undefined,
        );
        break;
      case "label":
        if (prop.value.kind === "string") config.label = prop.value.value;
        break;
      case "align":
        if (prop.value.kind === "ident" || prop.value.kind === "string") {
          const v = (prop.value.kind === "ident" ? prop.value.name : prop.value.value).toLowerCase();
          if (v === "left" || v === "center" || v === "right") config.align = v;
        }
        break;
      case "prefix":
        if (prop.value.kind === "string") config.formatOpts.prefix = prop.value.value;
        break;
      case "suffix":
        if (prop.value.kind === "string") config.formatOpts.suffix = prop.value.value;
        break;
    }
  }
  return config;
}

function buildColumnConfigs(
  component: ComponentNode,
  columns: string[],
): Map<string, ColumnConfig> {
  const map = new Map<string, ColumnConfig>();
  if (!component.columns) return map;
  for (const colDef of component.columns.columns) {
    if (columns.includes(colDef.name)) {
      map.set(colDef.name, getColumnConfig(colDef));
    }
  }
  return map;
}

export const tableRenderer: ComponentRenderer = {
  renderToString(component: ComponentNode, data: ComponentRenderData): string {
    if (!data.result?.rows?.length) {
      return `<div class="openboard-no-data">No data</div>`;
    }

    const { columns, rows } = data.result;
    const colConfigs = buildColumnConfigs(component, columns);
    const sortable = getBoolProp(component, "sortable") !== false;
    const filterable = getBoolProp(component, "filterable") ?? false;
    const pageSize = getNumberProp(component, "page_size") ?? 25;
    const totalRows = rows.length;
    const totalPages = Math.ceil(totalRows / pageSize);

    // Unique ID for this table instance (used by inline script)
    const tableId = `ob-table-${Math.random().toString(36).slice(2, 9)}`;

    // Build toolbar (filter + CSV export)
    const toolbar = renderToolbar(tableId, filterable, totalRows);

    // Build header
    const headerCells = columns
      .map((col) => {
        const config = colConfigs.get(col);
        const label = config?.label ?? col;
        const align = config?.align ?? "left";
        const sortAttr = sortable ? ` data-ob-sortable="true"` : "";
        return `<th class="openboard-table-th" data-ob-col="${escapeAttr(col)}" data-ob-align="${align}"${sortAttr}>${escapeHtml(label)}${sortable ? `<span class="openboard-sort-icon"></span>` : ""}</th>`;
      })
      .join("");

    // Build body rows (all rows rendered, pagination hides via CSS/JS)
    const bodyRows = rows
      .map((row, i) => {
        const hidden = i >= pageSize ? ` class="openboard-table-row-hidden"` : "";
        const cells = columns
          .map((col) => {
            const config = colConfigs.get(col);
            const rawValue = row[col];
            const format = config?.format ?? "raw";
            const formatted = formatValue(rawValue, format, config?.formatOpts);
            const prefix = config?.formatOpts.prefix ?? "";
            const suffix = config?.formatOpts.suffix ?? "";
            const display = `${prefix}${formatted}${suffix}`;
            const align = config?.align ?? "left";
            // Store raw value for sorting; display formatted value
            return `<td data-ob-raw="${escapeAttr(String(rawValue ?? ""))}" data-ob-align="${align}">${display}</td>`;
          })
          .join("");
        return `<tr data-ob-row="${i}"${hidden}>${cells}</tr>`;
      })
      .join("\n");

    // Build pagination
    const pagination = totalPages > 1
      ? renderPagination(tableId, totalRows, pageSize, totalPages)
      : `<div class="openboard-table-footer"><span class="openboard-table-row-count">${totalRows} row${totalRows !== 1 ? "s" : ""}</span></div>`;

    return `<div class="openboard-table-wrapper" id="${tableId}" data-ob-page-size="${pageSize}" data-ob-total="${totalRows}">
      ${toolbar}
      <div class="openboard-table-scroll">
        <table class="openboard-data-table openboard-data-table-full">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      ${pagination}
      ${renderTableScript(tableId)}
    </div>`;
  },
};

function renderToolbar(tableId: string, filterable: boolean, _totalRows: number): string {
  const filterInput = filterable
    ? `<input type="text" class="openboard-table-filter" placeholder="Filter rows\u2026" data-ob-filter="${tableId}" />`
    : "";

  return `<div class="openboard-table-toolbar">
      ${filterInput}
      <button class="openboard-table-csv-btn" data-ob-csv="${tableId}" title="Export CSV">&#x2913; CSV</button>
    </div>`;
}

function renderPagination(
  tableId: string,
  totalRows: number,
  pageSize: number,
  totalPages: number,
): string {
  return `<div class="openboard-table-footer" data-ob-pagination="${tableId}">
      <span class="openboard-table-row-count">${totalRows} row${totalRows !== 1 ? "s" : ""}</span>
      <div class="openboard-table-pagination">
        <button class="openboard-page-btn" data-ob-page-action="prev" disabled>&lsaquo; Prev</button>
        <span class="openboard-page-info">Page <span data-ob-current-page>1</span> of ${totalPages}</span>
        <button class="openboard-page-btn" data-ob-page-action="next"${totalPages <= 1 ? " disabled" : ""}>Next &rsaquo;</button>
      </div>
    </div>`;
}

/**
 * Inline script for client-side table interactivity.
 * Self-contained IIFE scoped to the table instance.
 */
function renderTableScript(tableId: string): string {
  return `<script>(function(){
var w=document.getElementById(${JSON.stringify(tableId)});
if(!w)return;
var table=w.querySelector("table");
var tbody=table.querySelector("tbody");
var rows=Array.from(tbody.querySelectorAll("tr"));
var ps=parseInt(w.dataset.obPageSize,10);
var total=rows.length;
var pages=Math.ceil(total/ps);
var curPage=1;
var sortCol=-1,sortAsc=true;
var filterVal="";
var filtered=rows.slice();

function show(){
  var start=(curPage-1)*ps,end=start+ps;
  rows.forEach(function(r){r.classList.add("openboard-table-row-hidden")});
  for(var i=start;i<end&&i<filtered.length;i++){
    filtered[i].classList.remove("openboard-table-row-hidden");
  }
  var pi=w.querySelector("[data-ob-current-page]");
  if(pi)pi.textContent=curPage;
  var pNav=w.querySelector("[data-ob-pagination]");
  if(pNav){
    var prevBtn=pNav.querySelector("[data-ob-page-action=prev]");
    var nextBtn=pNav.querySelector("[data-ob-page-action=next]");
    if(prevBtn)prevBtn.disabled=curPage<=1;
    if(nextBtn)nextBtn.disabled=curPage>=pages;
    var info=pNav.querySelector(".openboard-page-info");
    if(info)info.innerHTML="Page <span data-ob-current-page>"+curPage+"</span> of "+pages;
  }
}

function applyFilter(){
  var v=filterVal.toLowerCase();
  if(!v){filtered=rows.slice();}
  else{filtered=rows.filter(function(r){return r.textContent.toLowerCase().indexOf(v)!==-1});}
  total=filtered.length;
  pages=Math.max(1,Math.ceil(total/ps));
  curPage=1;
  var rc=w.querySelector(".openboard-table-row-count");
  if(rc)rc.textContent=total+" row"+(total!==1?"s":"");
  show();
}

// Sorting
var ths=Array.from(table.querySelectorAll("th[data-ob-sortable]"));
ths.forEach(function(th,ci){
  th.style.cursor="pointer";
  th.addEventListener("click",function(){
    if(sortCol===ci){sortAsc=!sortAsc}else{sortCol=ci;sortAsc=true}
    ths.forEach(function(h){
      var icon=h.querySelector(".openboard-sort-icon");
      if(icon)icon.textContent="";
      h.classList.remove("openboard-th-sorted-asc","openboard-th-sorted-desc");
    });
    var icon=th.querySelector(".openboard-sort-icon");
    if(icon)icon.textContent=sortAsc?" \\u25B2":" \\u25BC";
    th.classList.add(sortAsc?"openboard-th-sorted-asc":"openboard-th-sorted-desc");
    filtered.sort(function(a,b){
      var va=a.cells[ci].dataset.obRaw;
      var vb=b.cells[ci].dataset.obRaw;
      var na=parseFloat(va),nb=parseFloat(vb);
      var cmp;
      if(!isNaN(na)&&!isNaN(nb)){cmp=na-nb}else{cmp=va.localeCompare(vb)}
      return sortAsc?cmp:-cmp;
    });
    curPage=1;
    filtered.forEach(function(r){tbody.appendChild(r)});
    show();
  });
});

// Filter
var fi=w.querySelector("[data-ob-filter]");
if(fi){fi.addEventListener("input",function(){filterVal=fi.value;applyFilter()});}

// Pagination
var pNav=w.querySelector("[data-ob-pagination]");
if(pNav){
  pNav.addEventListener("click",function(e){
    var btn=e.target.closest("[data-ob-page-action]");
    if(!btn||btn.disabled)return;
    if(btn.dataset.obPageAction==="prev"&&curPage>1)curPage--;
    if(btn.dataset.obPageAction==="next"&&curPage<pages)curPage++;
    show();
  });
}

// CSV export
var csvBtn=w.querySelector("[data-ob-csv]");
if(csvBtn){csvBtn.addEventListener("click",function(){
  var heads=Array.from(table.querySelectorAll("thead th")).map(function(h){return h.textContent.trim()});
  var csvRows=[heads.join(",")];
  filtered.forEach(function(r){
    var cells=Array.from(r.querySelectorAll("td")).map(function(td){
      var v=td.dataset.obRaw;
      if(v.indexOf(",")!==-1||v.indexOf('"')!==-1||v.indexOf("\\n")!==-1){
        return '"'+v.replace(/"/g,'""')+'"';
      }
      return v;
    });
    csvRows.push(cells.join(","));
  });
  var blob=new Blob([csvRows.join("\\n")],{type:"text/csv"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="export.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});}

show();
})();</script>`;
}
