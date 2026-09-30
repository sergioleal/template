/**
 * Gráficos do assistente, em SVG, a partir de um QueryResult (até 2 dimensões + value).
 * Segue as especificações da skill de dataviz: paleta categórica validada em ordem fixa (--series-N),
 * barras <= 24px com ponta arredondada de 4px, linhas de 2px, marcadores r>=4 com anel da superfície,
 * área a ~10%, grade em hairline, legenda para 2+ séries, tooltip em toda marca e a tabela como alternativa.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { QueryResult } from "@agentikal/shared";

export type ChartKind = "bar" | "stacked_bar" | "line" | "area" | "pie";

const MAX_SERIES = 8;
const PIE_SLICES = 5;
const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const color = (i: number) => `var(--series-${(i % MAX_SERIES) + 1})`;
const OTHER = "Outros";

interface Series {
  name: string;
  values: number[];
}
interface Shaped {
  categories: string[];
  series: Series[];
}

/** Converte linhas (dim1, [dim2], value) em categorias × séries; séries além de 8 viram "Outros". */
function shape(result: QueryResult): Shaped {
  const dims = result.columns.length - 1;
  const label = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  if (dims <= 1) {
    return {
      categories: result.rows.map((r) => (dims === 0 ? "Total" : label(r[0]))),
      series: [{ name: String(result.columns.at(-1)), values: result.rows.map((r) => Number(r.at(-1)) || 0) }],
    };
  }
  const categories = [...new Set(result.rows.map((r) => label(r[0])))];
  const totals = new Map<string, number>();
  for (const r of result.rows) totals.set(label(r[1]), (totals.get(label(r[1])) ?? 0) + (Number(r[2]) || 0));
  let names = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)!);
  const folded = names.length > MAX_SERIES ? new Set(names.slice(MAX_SERIES - 1)) : new Set<string>();
  if (folded.size) names = [...names.slice(0, MAX_SERIES - 1), OTHER];
  const index = new Map(names.map((n, i) => [n, i]));
  const series = names.map((name) => ({ name, values: categories.map(() => 0) }));
  for (const r of result.rows) {
    const s = folded.has(label(r[1])) ? OTHER : label(r[1]);
    series[index.get(s)!]!.values[categories.indexOf(label(r[0]))]! += Number(r[2]) || 0;
  }
  return { categories, series };
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => setW(Math.max(200, Math.floor(w)));
    // Mede já na montagem: o ResizeObserver só dispara quando a página é desenhada.
    measure(el.clientWidth);
    const ro = new ResizeObserver(([e]) => measure(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

export function Chart({ kind, result }: { kind: ChartKind; result: QueryResult }) {
  const data = useMemo(() => shape(result), [result]);
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const multi = data.series.length > 1;

  if (result.columns.length === 1) {
    // Sem dimensão: é um número, não um gráfico.
    return <div className="viz-hero">{fmt.format(Number(result.rows[0]?.[0] ?? 0))}</div>;
  }

  const onTip = (e: React.MouseEvent, content: ReactNode) => {
    const box = ref.current!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };

  let body: ReactNode;
  if (kind === "pie") body = <Pie data={data} width={width} onTip={onTip} clear={() => setTip(null)} />;
  else if (kind === "line" || kind === "area")
    body = <Lines data={data} width={width} area={kind === "area"} onTip={onTip} clear={() => setTip(null)} />;
  else body = <Bars data={data} width={width} stacked={kind === "stacked_bar" || multi} onTip={onTip} clear={() => setTip(null)} />;

  const legendItems =
    kind === "pie" ? pieSlices(data).map((s) => s.name) : multi ? data.series.map((s) => s.name) : [];

  return (
    <div className="viz-root" ref={ref}>
      {legendItems.length > 1 && (
        <ul className="viz-legend">
          {legendItems.map((n, i) => (
            <li key={n}>
              <span className="viz-swatch" style={{ background: color(i) }} />
              {n}
            </li>
          ))}
        </ul>
      )}
      {body}
      {tip && (
        <div className="viz-tip" style={{ left: Math.min(tip.x + 12, width - 180), top: tip.y + 12 }}>
          {tip.content}
        </div>
      )}
    </div>
  );
}

type TipFn = (e: React.MouseEvent, content: ReactNode) => void;

function TipBody({ title, rows }: { title: string; rows: { name?: string; value: number; i: number }[] }) {
  return (
    <>
      <strong>{title}</strong>
      {rows.map((r) => (
        <span key={r.i} className="viz-tip-row">
          <span className="viz-swatch" style={{ background: color(r.i) }} />
          {r.name && <span className="muted">{r.name}</span>}
          <span className="viz-num">{fmt.format(r.value)}</span>
        </span>
      ))}
    </>
  );
}

/** Barras horizontais (categorias costumam ter nomes longos). Com 2 séries ou mais, empilhadas. */
function Bars({ data, width, stacked, onTip, clear }: { data: Shaped; width: number; stacked: boolean; onTip: TipFn; clear: () => void }) {
  const labelW = Math.min(180, Math.max(80, width * 0.3));
  const valueW = 56;
  const band = 34;
  const thick = 20;
  const top = 8;
  const plotW = width - labelW - valueW;
  const totals = data.categories.map((_, ci) => data.series.reduce((s, se) => s + (se.values[ci] ?? 0), 0));
  const ticks = niceTicks(Math.max(...(stacked ? totals : data.series[0]!.values), 0));
  const max = ticks.at(-1)!;
  const x = (v: number) => (v / max) * plotW;
  const height = top + data.categories.length * band + 24;

  return (
    <svg width={width} height={height} role="img" aria-label="Gráfico de barras">
      {ticks.map((t) => (
        <g key={t}>
          <line className="viz-grid" x1={labelW + x(t)} x2={labelW + x(t)} y1={top} y2={height - 20} />
          <text className="viz-tick" x={labelW + x(t)} y={height - 6} textAnchor="middle">
            {fmt.format(t)}
          </text>
        </g>
      ))}
      {data.categories.map((cat, ci) => {
        const y = top + ci * band + (band - thick) / 2;
        let acc = 0;
        const segs = (stacked ? data.series : data.series.slice(0, 1)).map((s, si) => {
          const v = s.values[ci] ?? 0;
          const x0 = acc;
          acc += v;
          return { si, v, x0, name: s.name };
        });
        const nonzero = segs.filter((s) => s.v > 0);
        const last = nonzero.at(-1);
        return (
          <g key={cat}>
            <text className="viz-label" x={labelW - 8} y={y + thick / 2 + 4} textAnchor="end">
              {truncate(cat, Math.floor(labelW / 7))}
            </text>
            {nonzero.map((s) => {
              // 2px de superfície entre segmentos; só a ponta final é arredondada.
              const gap = s === last ? 0 : 2;
              const w = Math.max(0, x(s.v) - gap);
              return (
                <path
                  key={s.si}
                  d={roundedRight(labelW + x(s.x0), y, w, thick, s === last ? 4 : 0)}
                  fill={color(s.si)}
                  onMouseMove={(e) =>
                    onTip(e, <TipBody title={cat} rows={segs.filter((z) => z.v > 0).map((z) => ({ name: stacked && data.series.length > 1 ? z.name : undefined, value: z.v, i: z.si }))} />)
                  }
                  onMouseLeave={clear}
                />
              );
            })}
            <text className="viz-value" x={labelW + x(acc) + 6} y={y + thick / 2 + 4}>
              {fmt.format(acc)}
            </text>
          </g>
        );
      })}
      <line className="viz-axis" x1={labelW} x2={labelW} y1={top} y2={height - 20} />
    </svg>
  );
}

function roundedRight(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

/** Linhas (ou áreas) ao longo das categorias, com crosshair e tooltip no ponto mais próximo. */
function Lines({ data, width, area, onTip, clear }: { data: Shaped; width: number; area: boolean; onTip: TipFn; clear: () => void }) {
  const left = 48;
  const right = 16;
  const top = 12;
  const height = 240;
  const bottom = 28;
  const n = data.categories.length;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const ticks = niceTicks(Math.max(...data.series.flatMap((s) => s.values), 0));
  const max = ticks.at(-1)!;
  const xAt = (i: number) => left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => top + plotH - (v / max) * plotH;
  const [hover, setHover] = useState<number | null>(null);
  const every = Math.max(1, Math.ceil(n / Math.floor(plotW / 64)));

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="Gráfico de linhas"
      onMouseMove={(e) => {
        const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const i = Math.round(((e.clientX - box.left - left) / plotW) * (n - 1));
        const idx = Math.min(n - 1, Math.max(0, n === 1 ? 0 : i));
        setHover(idx);
        onTip(e, <TipBody title={data.categories[idx]!} rows={data.series.map((s, si) => ({ name: data.series.length > 1 ? s.name : undefined, value: s.values[idx] ?? 0, i: si }))} />);
      }}
      onMouseLeave={() => {
        setHover(null);
        clear();
      }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line className="viz-grid" x1={left} x2={width - right} y1={yAt(t)} y2={yAt(t)} />
          <text className="viz-tick" x={left - 8} y={yAt(t) + 4} textAnchor="end">
            {fmt.format(t)}
          </text>
        </g>
      ))}
      {data.categories.map((c, i) =>
        i % every === 0 ? (
          <text key={c} className="viz-tick" x={xAt(i)} y={height - 8} textAnchor="middle">
            {truncate(c, 12)}
          </text>
        ) : null,
      )}
      {hover !== null && <line className="viz-crosshair" x1={xAt(hover)} x2={xAt(hover)} y1={top} y2={top + plotH} />}
      {data.series.map((s, si) => {
        const pts = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`);
        return (
          <g key={s.name}>
            {area && (
              <path
                d={`M${xAt(0)},${yAt(0)} L${pts.join(" L")} L${xAt(n - 1)},${yAt(0)} Z`}
                fill={color(si)}
                fillOpacity={0.1}
              />
            )}
            <polyline points={pts.join(" ")} fill="none" stroke={color(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {(hover !== null ? [hover] : n <= 12 ? s.values.map((_, i) => i) : [n - 1]).map((i) => (
              <circle key={i} cx={xAt(i)} cy={yAt(s.values[i] ?? 0)} r={4} fill={color(si)} className="viz-dot" />
            ))}
          </g>
        );
      })}
      <line className="viz-axis" x1={left} x2={width - right} y1={yAt(0)} y2={yAt(0)} />
    </svg>
  );
}

function pieSlices(data: Shaped) {
  const totals = data.categories.map((c, ci) => ({ name: c, value: data.series.reduce((s, se) => s + (se.values[ci] ?? 0), 0) }));
  totals.sort((a, b) => b.value - a.value);
  if (totals.length <= PIE_SLICES) return totals;
  const rest = totals.slice(PIE_SLICES - 1).reduce((s, t) => s + t.value, 0);
  return [...totals.slice(0, PIE_SLICES - 1), { name: OTHER, value: rest }];
}

/** Rosca: poucas partes de um todo (até 5 fatias; o resto vira "Outros"). */
function Pie({ data, width, onTip, clear }: { data: Shaped; width: number; onTip: TipFn; clear: () => void }) {
  const slices = pieSlices(data);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = Math.min(240, width);
  const r = size / 2 - 4;
  const inner = r * 0.6;
  const cx = width / 2;
  const cy = size / 2;
  let a0 = -Math.PI / 2;
  return (
    <svg width={width} height={size} role="img" aria-label="Gráfico de rosca">
      {slices.map((s, i) => {
        const a1 = a0 + (s.value / total) * Math.PI * 2;
        const d = arc(cx, cy, r, inner, a0, a1);
        a0 = a1;
        return (
          <path
            key={s.name}
            d={d}
            fill={color(i)}
            className="viz-slice"
            onMouseMove={(e) =>
              onTip(e, <TipBody title={s.name} rows={[{ value: s.value, i }]} />)
            }
            onMouseLeave={clear}
          />
        );
      })}
      <text className="viz-pie-total" x={cx} y={cy + 6} textAnchor="middle">
        {fmt.format(total)}
      </text>
    </svg>
  );
}

function arc(cx: number, cy: number, r: number, ri: number, a0: number, a1: number) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  return `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${large} 0 ${p(ri, a0)} Z`;
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** Alternativa em tabela (obrigatória: algumas cores da paleta ficam abaixo de 3:1 no tema claro). */
export function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="table-wrap viz-table">
      <table>
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} className={c === "value" ? "right" : undefined}>
                {c === "value" ? "valor" : c.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={j === r.length - 1 ? "right viz-num" : undefined}>
                  {typeof v === "number" ? fmt.format(v) : (v ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
