import React, { useEffect, useRef, useCallback } from "react";

interface BuildStatus {
  task_id: string; status: string; stage: string;
  progress_percent: number; message: string; error?: string;
}

const STAGE_NAMES: Record<string, string> = {
  queued: "В очереди", init: "Инициализация",
  load_pim_cats: "Загрузка категорий PIM",
  fetch_ozon: "Загрузка дерева Ozon", fetch_mm: "Загрузка дерева Megamarket",
  ai_ozon_cats: "AI выбирает категории Ozon", ai_mm_cats: "AI выбирает категории Megamarket",
  build_attrs: "Построение связей атрибутов", phased_matching: "Семантический маппинг",
  done: "Карта построена", error: "Ошибка",
};

const OZ_NAMES = ["Название","Бренд","Цвет","Материал","Страна","Вес, г","Высота, мм",
  "Ширина, мм","Глубина, мм","Мощность, Вт","Гарантия","Артикул","Штрихкод","Описание",
  "Комплектация","Тип","Серия","Модель","Напряжение","Тип управления","Тип покрытия",
  "Объём, л","Цвет корпуса","Потребление","Класс энергоэфф."];

const MM_NAMES = ["Наименование карточки","Производитель","Цвет товара","Материал корпуса",
  "Страна-изготовитель","Вес (кг)","Высота (упаковки)","Ширина (упаковки)","Глубина изделия",
  "Мощность микроволн, Вт","Гарантийный срок","Артикул производителя","Штрихкод","Описание товара",
  "Состав набора","Вид","Серия продукта","Модель","Напряжение питания","Тип управления",
  "Покрытие камеры","Объём камеры","Цвет","Мощность, Вт","Класс энергопотребления"];

interface SNode { x:number; y:number; z:number; label:string; platform:"ozon"|"mm"; connected:boolean; }
interface SEdge { from:number; to:number; strength:number; }

function goldenSphere(n: number, r: number): [number,number,number][] {
  const phi = Math.PI * (3 - Math.sqrt(5));
  return Array.from({length: n}, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const theta = phi * i;
    return [Math.cos(theta)*rad*r, y*r, Math.sin(theta)*rad*r];
  });
}

function buildNodes(): SNode[] {
  const ozPos = goldenSphere(OZ_NAMES.length, 140);
  const mmPos = goldenSphere(MM_NAMES.length, 140);
  const oz: SNode[] = ozPos.map(([x,y,z], i) => ({
    x: x - 130, y, z, label: OZ_NAMES[i] ?? `oz_${i}`, platform: "ozon", connected: false,
  }));
  const mm: SNode[] = mmPos.map(([x,y,z], i) => ({
    x: x + 130, y, z, label: MM_NAMES[i] ?? `mm_${i}`, platform: "mm", connected: false,
  }));
  return [...oz, ...mm];
}

function seededRng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) | 0; return Math.abs(s) / 2147483647; };
}

export default function NeuralMapLoader({ status }: { status: BuildStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const st = useRef({
    nodes: buildNodes(),
    edges: [] as SEdge[],
    rotY: 0, rotX: 0.25, frame: 0,
    hoveredNode: -1,
    selectedNode: -1,
    highlightedEdges: new Set<number>(),
    highlightedNodes: new Set<number>(),
    mouseX: 0, mouseY: 0,
    dragging: false, lastMouseX: 0, lastMouseY: 0,
  });

  const progress = status.progress_percent;
  const isDone = status.status === "done";
  const isError = status.status === "error";

  // Rebuild edges on progress change
  useEffect(() => {
    const rng = seededRng(42);
    const nodes = st.current.nodes;
    const ozCount = OZ_NAMES.length;
    const mmStart = ozCount;
    const mmCount = MM_NAMES.length;
    const maxEdges = ozCount * mmCount;
    const targetEdges = Math.floor((maxEdges * Math.min(progress, 100)) / 100);

    const pairs: [number,number][] = [];
    for (let i = 0; i < ozCount; i++)
      for (let j = 0; j < mmCount; j++)
        pairs.push([i, mmStart + j]);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    nodes.forEach(n => n.connected = false);
    const edges: SEdge[] = [];
    for (let k = 0; k < Math.min(targetEdges, pairs.length); k++) {
      const [f, t] = pairs[k];
      edges.push({ from: f, to: t, strength: 0.35 + rng() * 0.65 });
      nodes[f].connected = true;
      nodes[t].connected = true;
    }
    st.current.edges = edges;
    st.current.selectedNode = -1;
    st.current.highlightedEdges.clear();
    st.current.highlightedNodes.clear();
  }, [progress]);

  const project = useCallback((x: number, y: number, z: number) => {
    const { rotX, rotY } = st.current;
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    let rx = x * cosY - z * sinY;
    let rz = x * sinY + z * cosY;
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    let ry = y * cosX - rz * sinX;
    rz = y * sinX + rz * cosX;
    const fov = 700;
    const scale = fov / (fov + rz + 250);
    return { sx: rx * scale, sy: ry * scale, scale, rz };
  }, []);

  // Hit test
  const hitTest = useCallback((mouseX: number, mouseY: number, W: number, H: number) => {
    const CX = W / 2, CY = H / 2;
    const nodes = st.current.nodes;
    let best = -1, bestDist = 16;
    nodes.forEach((n, i) => {
      const p = project(n.x, n.y, n.z);
      const dx = (CX + p.sx) - mouseX;
      const dy = (CY + p.sy) - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = (n.connected ? 5 : 2.5) * p.scale;
      if (dist < Math.max(r + 6, bestDist)) { bestDist = dist; best = i; }
    });
    return best;
  }, [project]);

  const selectNode = useCallback((nodeIdx: number) => {
    const s = st.current;
    if (nodeIdx === s.selectedNode) {
      s.selectedNode = -1;
      s.highlightedEdges.clear();
      s.highlightedNodes.clear();
      return;
    }
    s.selectedNode = nodeIdx;
    s.highlightedEdges.clear();
    s.highlightedNodes.clear();
    s.highlightedNodes.add(nodeIdx);
    s.edges.forEach((e, ei) => {
      if (e.from === nodeIdx || e.to === nodeIdx) {
        s.highlightedEdges.add(ei);
        s.highlightedNodes.add(e.from);
        s.highlightedNodes.add(e.to);
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const CX = W / 2, CY = H / 2;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width;
      const scaleY = H / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      const s = st.current;
      if (s.dragging) {
        s.rotY += (mx - s.lastMouseX) * 0.005;
        s.rotX += (my - s.lastMouseY) * 0.005;
        s.rotX = Math.max(-1.2, Math.min(1.2, s.rotX));
      }
      s.mouseX = mx; s.mouseY = my;
      s.lastMouseX = mx; s.lastMouseY = my;
      s.hoveredNode = hitTest(mx, my, W, H);
      canvas.style.cursor = s.hoveredNode >= 0 ? "pointer" : "grab";
    };
    const onMouseDown = (e: MouseEvent) => {
      st.current.dragging = true;
      const rect = canvas.getBoundingClientRect();
      st.current.lastMouseX = (e.clientX - rect.left) * (W / rect.width);
      st.current.lastMouseY = (e.clientY - rect.top) * (H / rect.height);
    };
    const onMouseUp = (e: MouseEvent) => {
      const s = st.current;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (W / rect.width);
      const my = (e.clientY - rect.top) * (H / rect.height);
      const moved = Math.abs(mx - s.lastMouseX) + Math.abs(my - s.lastMouseY);
      if (moved < 4 && s.hoveredNode >= 0) selectNode(s.hoveredNode);
      s.dragging = false;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", () => { st.current.dragging = false; st.current.hoveredNode = -1; });

    const draw = () => {
      const s = st.current;
      s.frame++;
      if (!s.dragging) s.rotY += isDone ? 0.003 : 0.006;

      ctx.clearRect(0, 0, W, H);

      // BG
      ctx.fillStyle = "#050510";
      ctx.fillRect(0, 0, W, H);

      // Ambient center glow
      const cg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 200);
      cg.addColorStop(0, `rgba(99,40,220,${0.06 + 0.03 * Math.sin(s.frame * 0.03)})`);
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);

      const nodes = s.nodes;
      const edges = s.edges;
      const hasSelection = s.selectedNode >= 0;

      // Project
      const proj = nodes.map(n => {
        const p = project(n.x, n.y, n.z);
        return { ...p, sx: CX + p.sx, sy: CY + p.sy };
      });

      // Sort edges by depth
      const sortedEdgeIdx = edges.map((_, i) => i).sort((a, b) => {
        const za = (proj[edges[a].from].rz + proj[edges[a].to].rz) / 2;
        const zb = (proj[edges[b].from].rz + proj[edges[b].to].rz) / 2;
        return za - zb;
      });

      // Draw edges
      sortedEdgeIdx.forEach(ei => {
        const e = edges[ei];
        const fp = proj[e.from], tp = proj[e.to];
        const isHighlighted = s.highlightedEdges.has(ei);
        const dimmed = hasSelection && !isHighlighted;
        const isLive = !isDone && (ei % 6 === s.frame % 6);
        const pulse = 0.5 + 0.5 * Math.sin(s.frame * 0.05 + ei * 0.8);

        let alpha: number;
        if (dimmed) alpha = 0.04;
        else if (isHighlighted) alpha = 0.9;
        else if (isDone) alpha = e.strength * 0.45;
        else alpha = isLive ? e.strength * pulse * 0.85 : e.strength * 0.2;

        const grad = ctx.createLinearGradient(fp.sx, fp.sy, tp.sx, tp.sy);
        if (isHighlighted) {
          grad.addColorStop(0, `rgba(255,200,50,${alpha})`);
          grad.addColorStop(0.5, `rgba(255,255,150,${alpha})`);
          grad.addColorStop(1, `rgba(255,200,50,${alpha})`);
        } else {
          grad.addColorStop(0, `rgba(99,102,241,${alpha})`);
          grad.addColorStop(0.5, `rgba(168,85,247,${alpha * 1.4})`);
          grad.addColorStop(1, `rgba(251,146,60,${alpha})`);
        }

        ctx.beginPath();
        const mx2 = (fp.sx + tp.sx) / 2 + (Math.random() - 0.5) * 2;
        const my2 = (fp.sy + tp.sy) / 2 + (Math.random() - 0.5) * 2;
        ctx.moveTo(fp.sx, fp.sy);
        ctx.quadraticCurveTo(CX + (mx2 - CX) * 0.3, CY + (my2 - CY) * 0.3, tp.sx, tp.sy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = isHighlighted ? 2 : (isLive ? 1.2 * e.strength : 0.5);
        ctx.stroke();

        // Spark
        if ((isLive && e.strength > 0.55 && !dimmed) || isHighlighted) {
          const t2 = ((s.frame * 0.025 + ei * 0.13) % 1);
          const px2 = fp.sx + (tp.sx - fp.sx) * t2;
          const py2 = fp.sy + (tp.sy - fp.sy) * t2;
          ctx.beginPath();
          ctx.arc(px2, py2, isHighlighted ? 3 : 2, 0, Math.PI * 2);
          ctx.fillStyle = isHighlighted ? `rgba(255,255,100,0.95)` : `rgba(255,255,255,${0.8 * pulse})`;
          ctx.fill();
        }
      });

      // Draw nodes
      [...nodes.map((n, i) => ({ n, p: proj[i], i }))]
        .sort((a, b) => a.p.rz - b.p.rz)
        .forEach(({ n, p, i }) => {
          const isHovered = s.hoveredNode === i;
          const isSelected = s.selectedNode === i;
          const isHighlighted = s.highlightedNodes.has(i);
          const dimmed = hasSelection && !isHighlighted;
          const pulse = 0.6 + 0.4 * Math.sin(s.frame * 0.07 + p.sx * 0.03);

          const baseR = (n.connected ? 5 : 2) * p.scale;
          const r = isHovered || isSelected ? baseR * 1.8 : baseR;
          const color = n.platform === "ozon" ? [99,102,241] : [251,146,60];
          const alpha = dimmed ? 0.12 : (n.connected ? pulse : 0.25);
          const glowAlpha = dimmed ? 0 : (isHighlighted || isHovered ? 0.5 : 0.15) * pulse;

          if ((n.connected && !dimmed) || isHovered) {
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, r + 5 * p.scale, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${color.join(",")},${glowAlpha})`;
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
          ctx.fillStyle = isSelected
            ? `rgba(255,220,50,${alpha})`
            : isHighlighted
              ? `rgba(255,200,50,${alpha})`
              : `rgba(${color.join(",")},${alpha})`;
          ctx.fill();

          // Label on hover/select/highlight
          if (isHovered || isSelected || isHighlighted) {
            const isLeft = n.platform === "ozon";
            ctx.font = `${isSelected ? "700" : "600"} ${11 * Math.max(0.8, p.scale)}px Inter, sans-serif`;
            ctx.textAlign = isLeft ? "right" : "left";
            ctx.textBaseline = "middle";
            const tx = isLeft ? p.sx - r - 6 : p.sx + r + 6;
            ctx.fillStyle = isSelected ? "rgba(255,230,80,1)" : isHighlighted ? "rgba(255,220,80,0.9)" : "rgba(255,255,255,0.9)";
            ctx.fillText(n.label, tx, p.sy);
          }
        });

      // Center badge
      const badgePulse = 1 + 0.05 * Math.sin(s.frame * 0.05);
      const bg2 = ctx.createRadialGradient(CX, CY, 0, CX, CY, 36 * badgePulse);
      bg2.addColorStop(0, "rgba(120,60,220,0.95)");
      bg2.addColorStop(1, "rgba(80,20,180,0.7)");
      ctx.beginPath();
      ctx.arc(CX, CY, 36 * badgePulse, 0, Math.PI * 2);
      ctx.fillStyle = bg2;
      ctx.fill();
      ctx.font = `bold ${isDone ? 20 : 18}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(isDone ? "✓" : `${progress}%`, CX, CY - 6);
      ctx.font = "500 9px Inter, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(isDone ? "ГОТОВО" : "AI", CX, CY + 12);

      // Tooltip for selected node
      if (s.selectedNode >= 0 && s.highlightedNodes.size > 1) {
        const selNode = nodes[s.selectedNode];
        const connectedCount = s.highlightedEdges.size;
        const tipX = s.mouseX, tipY = Math.max(40, s.mouseY - 50);
        ctx.fillStyle = "rgba(20,10,40,0.92)";
        ctx.beginPath();
        ctx.roundRect(tipX - 120, tipY - 26, 240, 50, 8);
        ctx.fill();
        ctx.strokeStyle = selNode.platform === "ozon" ? "rgba(99,102,241,0.6)" : "rgba(251,146,60,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = "600 12px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(selNode.label, tipX, tipY - 8);
        ctx.font = "11px Inter, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillText(`${connectedCount} связей → ${selNode.platform === "ozon" ? "Megamarket" : "Ozon"}`, tipX, tipY + 12);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
    };
  }, [progress, isDone, project, selectNode]);

  return (
    <div ref={containerRef} style={{
      background: "#050510",
      border: `1px solid ${isDone ? "rgba(16,185,129,0.25)" : isError ? "rgba(248,113,113,0.25)" : "rgba(99,102,241,0.18)"}`,
      borderRadius: 20, overflow: "hidden",
      boxShadow: isDone ? "0 0 50px rgba(16,185,129,0.06)" : "0 0 50px rgba(99,102,241,0.06)",
    }}>
      {/* Header */}
      <div style={{ padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: isDone ? "#10b981" : isError ? "#f87171" : "rgba(255,255,255,0.9)" }}>
            {isDone ? "Нейронная карта построена" : isError ? "Ошибка" : "Строю нейронную карту связей..."}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            {STAGE_NAMES[status.stage] ?? status.stage} · Нажмите на узел чтобы проследить связи
          </div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {[["#6366f1","Ozon"],["#a855f7",`${st.current.edges.length} связей`],["#fb923c","Megamarket"]].map(([c,l]) => (
            <div key={l} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:c }} />
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} width={960} height={480}
        style={{ display:"block", width:"100%", height:"auto", cursor:"grab" }} />

      {/* Footer */}
      <div style={{ padding:"10px 22px", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, marginBottom:8, overflow:"hidden" }}>
          <div style={{
            height:"100%", borderRadius:2, width:`${progress}%`, transition:"width 0.8s",
            background: isDone ? "#10b981" : "linear-gradient(90deg,#6366f1,#a855f7,#ec4899)",
            boxShadow: isDone ? "none" : "0 0 8px rgba(168,85,247,0.6)",
          }} />
        </div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {status.message}
        </div>
      </div>
    </div>
  );
}
