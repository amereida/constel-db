// concept-map-3d.js — grafo 3D force-directed con 3d-force-graph + Three.js
// Adaptado de logseq-constel/src/render3d.ts para el modelo de datos de con§tel.

import { state, computeConceptGraph, getThemeColor } from "../state.js";

let activeGraph = null;
let activeListeners = [];

export function cleanupGraph3D() {
  for (const { event, fn } of activeListeners) {
    document.removeEventListener(event, fn);
  }
  activeListeners = [];

  if (activeGraph) {
    activeGraph._destructor?.();
    activeGraph = null;
  }
}

/**
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {number} [opts.threshold=1]
 * @param {boolean} [opts.showEdges=true]
 * @param {Function} opts.onClickConcept
 * @returns {Object|null} controller
 */
export function renderConceptMap3D(container, opts = {}) {
  const ForceGraph3D = window.ForceGraph3D;
  const THREE = window.THREE;

  if (!ForceGraph3D || !THREE) {
    container.innerHTML = `<p class="placeholder">3d-force-graph no está cargado</p>`;
    return null;
  }

  const { nodes, links } = computeConceptGraph(opts.sourceId || null);
  if (!nodes.length) {
    container.innerHTML = `<p class="placeholder">Marca pasajes con conceptos para ver el mapa</p>`;
    return null;
  }

  cleanupGraph3D();
  container.innerHTML = "";

  const width = container.clientWidth || 600;
  const height = container.clientHeight || 400;
  const threshold = opts.threshold || 1;
  const showEdges = opts.showEdges !== false;

  // CSS vars
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  let isDark = root.getAttribute("data-theme") === "dark";
  const textColor = cs.getPropertyValue("--ink").trim() || (isDark ? "#e7dada" : "#333");
  const mutedColor = cs.getPropertyValue("--muted").trim() || "#e3e3e967";

  // ── Font size scale ──
  const maxExc = Math.max(1, ...nodes.map(n => n.excerptCount));
  const maxSrc = Math.max(1, ...nodes.map(n => n.sourceCount));

  function fontSize(d) {
    const score = (d.excerptCount / maxExc) * 0.6 + (d.sourceCount / maxSrc) * 0.4;
    return Math.round(11 + score * 20);
  }

  // ── Filter links ──
  let currentThreshold = threshold;
  let visibleLinks = links.filter(l => l.weight >= currentThreshold);
  const maxWeight = Math.max(1, ...links.map(l => l.weight));

  // ── Prepare data (3d-force-graph mutates) ──
  const nodes3d = nodes.map(n => ({
    id: n.id,
    label: n.label,
    themeId: n.themeId,
    excerptCount: n.excerptCount,
    sourceCount: n.sourceCount,
  }));

  const links3d = visibleLinks.map(l => ({
    source: l.source,
    target: l.target,
    weight: l.weight,
  }));

  // ── Text wrapping ──
  const MAX_CHARS = 40;
  function wrapText(text, maxChars) {
    if (text.length <= maxChars) return [text];
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      if (current && (current.length + 1 + word.length) > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
  }

  // ── Selection state ──
  let selectedNodeId = null;

  // ── Create billboard sprite for each node ──
  function createNodeSprite(node) {
    const selected = node.id === selectedNodeId;
    const fSize = fontSize(node);
    const themeColor = getThemeColor(node.themeId);
    const dpr = 2;
    const spriteFontSize = fSize * 3;
    const fontStr = `${spriteFontSize * dpr}px Gabarito, system-ui, -apple-system, sans-serif`;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const lines = wrapText(node.label, MAX_CHARS);
    const lineHeight = spriteFontSize * dpr * 1.3;

    // measure text
    ctx.font = fontStr;
    let maxLineW = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineW) maxLineW = w;
    }

    const textBlockH = lines.length * lineHeight;
    const hPad = 36 * dpr;
    const padding = 8 * dpr;

    const totalWidth = maxLineW + hPad + padding * 2;
    const totalHeight = textBlockH + padding * 2;
    canvas.width = totalWidth;
    canvas.height = totalHeight;

    const cx = totalWidth / 2;
    const cy = totalHeight / 2;

    // re-set font after canvas resize
    ctx.font = fontStr;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    // pill background
    const pillH = textBlockH + 12 * dpr;
    const pillW = maxLineW + hPad;
    const rx = cx - pillW / 2;
    const ry = cy - pillH / 2;
    const rr = Math.min(pillH / 2, 12 * dpr);

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = selected
      ? (isDark ? "rgba(0, 0, 0, 0.97)" : "rgba(255, 255, 255, 0.94)")
      : (isDark ? "rgba(0, 0, 0, 0.37)" : "rgba(255, 255, 255, 0.59)");
    ctx.beginPath();
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + pillW - rr, ry);
    ctx.quadraticCurveTo(rx + pillW, ry, rx + pillW, ry + rr);
    ctx.lineTo(rx + pillW, ry + pillH - rr);
    ctx.quadraticCurveTo(rx + pillW, ry + pillH, rx + pillW - rr, ry + pillH);
    ctx.lineTo(rx + rr, ry + pillH);
    ctx.quadraticCurveTo(rx, ry + pillH, rx, ry + pillH - rr);
    ctx.lineTo(rx, ry + rr);
    ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
    ctx.closePath();
    ctx.fill();

    // selected: colored border around the pill
    if (selected) {
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 3 * dpr;
      ctx.stroke();
    }

    // text in theme color
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = themeColor;
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, startY + i * lineHeight);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.renderOrder = 10; // render on top of links

    const worldScale = totalWidth / (dpr * 8);
    const aspect = totalWidth / totalHeight;
    sprite.scale.set(worldScale, worldScale / aspect, 1);

    return sprite;
  }

  // ── Custom force: attract nodes toward their theme centroid ──
  function forceGroupCentroid3D() {
    let _nodes;
    const strength = 0.15;

    function force(alpha) {
      const groups = new Map();
      for (const node of _nodes) {
        const tid = node.themeId || "__none__";
        if (!groups.has(tid)) groups.set(tid, []);
        groups.get(tid).push(node);
      }
      for (const [, groupNodes] of groups) {
        if (groupNodes.length < 2) continue;
        let cx = 0, cy = 0, cz = 0;
        for (const n of groupNodes) {
          cx += n.x || 0; cy += n.y || 0; cz += n.z || 0;
        }
        cx /= groupNodes.length; cy /= groupNodes.length; cz /= groupNodes.length;
        for (const n of groupNodes) {
          n.vx += ((cx - (n.x || 0)) * strength * alpha);
          n.vy += ((cy - (n.y || 0)) * strength * alpha);
          n.vz += ((cz - (n.z || 0)) * strength * alpha);
        }
      }
    }
    force.initialize = function(nodes) { _nodes = nodes; };
    return force;
  }

  // ── Centroid lines: Three.js dashed lines per theme group ──
  const centroidGroup = new THREE.Group();
  centroidGroup.name = "centroidLines";
  let centroidEdgesVisible = showEdges;

  // Materials cache per theme color
  const centroidMaterials = new Map();
  function getCentroidMaterial(color) {
    if (centroidMaterials.has(color)) return centroidMaterials.get(color);
    const mat = new THREE.LineDashedMaterial({
      color: new THREE.Color(color),
      dashSize: 2,
      gapSize: 1.5,
      opacity: 0.3,
      transparent: true,
    });
    centroidMaterials.set(color, mat);
    return mat;
  }

  function updateCentroidLines() {
    // Remove old lines
    while (centroidGroup.children.length) {
      const child = centroidGroup.children[0];
      child.geometry.dispose();
      centroidGroup.remove(child);
    }

    if (!centroidEdgesVisible) return;

    // Group nodes by theme
    const data = graph.graphData();
    const groups = new Map();
    for (const node of data.nodes) {
      if (!node.themeId) continue;
      if (!groups.has(node.themeId)) groups.set(node.themeId, []);
      groups.get(node.themeId).push(node);
    }

    for (const [themeId, groupNodes] of groups) {
      if (groupNodes.length < 2) continue;

      // Compute centroid
      let cx = 0, cy = 0, cz = 0;
      for (const n of groupNodes) {
        cx += n.x || 0; cy += n.y || 0; cz += n.z || 0;
      }
      cx /= groupNodes.length; cy /= groupNodes.length; cz /= groupNodes.length;

      const color = getThemeColor(themeId);
      const material = getCentroidMaterial(color);

      for (const node of groupNodes) {
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(node.x || 0, node.y || 0, node.z || 0),
          new THREE.Vector3(cx, cy, cz),
        ]);
        const line = new THREE.Line(geom, material);
        line.computeLineDistances(); // required for dashed to work
        centroidGroup.add(line);
      }
    }
  }

  // ── Instantiate graph ──
  const graph = new ForceGraph3D(container, {
    controlType: "orbit",
    rendererConfig: { preserveDrawingBuffer: true, antialias: true },
  })
    .width(width)
    .height(height)
    .backgroundColor("rgba(0, 0, 0, 0)")
    .graphData({ nodes: nodes3d, links: links3d })
    .nodeThreeObject(node => createNodeSprite(node))
    .nodeThreeObjectExtend(false)
    .linkColor(() => showEdges ? mutedColor : "rgba(0,0,0,0)")
    .linkOpacity(showEdges ? 0.3 : 0)
    .linkWidth(l => showEdges ? Math.max(0.3, (l.weight / maxWeight) * 2) : 0)
    .onNodeClick(node => {
      if (!node) return;
      selectedNodeId = node.id;
      graph.nodeThreeObject(n => createNodeSprite(n));
      const cam = graph.cameraPosition();
      graph.cameraPosition(cam, { x: node.x, y: node.y, z: node.z }, 600);
      if (opts.onClickConcept) opts.onClickConcept(node.id);
    })
    .onNodeHover(node => {
      container.style.cursor = node ? "pointer" : "default";
    })
    .enableNavigationControls(true)
    .onEngineTick(() => {
      updateCentroidLines();
    });

  // Register custom group centroid force
  graph.d3Force("groupCentroid", forceGroupCentroid3D());

  // Add centroid lines group to the scene
  graph.scene().add(centroidGroup);

  // Auto-fit
  setTimeout(() => {
    graph.zoomToFit(400, 60);
  }, 500);

  activeGraph = graph;

  // ── Spacebar pan: hold Space to switch left-drag from orbit to pan ──
  const controls = graph.controls();
  let spaceHeld = false;

  function onKeyDown(e) {
    if (e.code === "Space" && !spaceHeld) {
      e.preventDefault();
      spaceHeld = true;
      // OrbitControls: mouseButtons.LEFT = THREE.MOUSE.PAN
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      container.style.cursor = "grab";
    }
  }
  function onKeyUp(e) {
    if (e.code === "Space") {
      spaceHeld = false;
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      container.style.cursor = "default";
    }
  }
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  activeListeners.push(
    { event: "keydown", fn: onKeyDown },
    { event: "keyup", fn: onKeyUp },
  );

  // ── Controller (compatible API subset) ──
  return {
    setThreshold(thresh) {
      currentThreshold = thresh;
      visibleLinks = links.filter(l => l.weight >= currentThreshold);
      // Re-use existing node positions — graphData merges by id
      const currentData = graph.graphData();
      const newLinks = visibleLinks.map(l => ({
        source: l.source,
        target: l.target,
        weight: l.weight,
      }));
      graph.graphData({ nodes: currentData.nodes, links: newLinks });
    },

    setStrength(factor) {
      // factor: 0.2 (loose) to 6.0 (tight), normalized from slider 1-30 → /5
      const linkForce = graph.d3Force("link");
      const chargeForce = graph.d3Force("charge");
      if (linkForce) {
        linkForce.distance(d => (60 * (1.5 - (d.weight || 1) / maxWeight)) / factor);
        linkForce.strength(d => Math.min(1, (0.2 + ((d.weight || 1) / maxWeight) * 0.8) * factor));
      }
      if (chargeForce) {
        chargeForce.strength(-30 / Math.max(0.5, factor * 0.3));
      }
      graph.d3ReheatSimulation();
    },

    setEdgesVisible(visible) {
      centroidEdgesVisible = visible;
      graph
        .linkColor(() => visible ? mutedColor : "rgba(0,0,0,0)")
        .linkOpacity(visible ? 0.3 : 0)
        .linkWidth(l => visible ? Math.max(0.3, (l.weight / maxWeight) * 2) : 0);
      if (!visible) updateCentroidLines(); // clear them immediately
    },

    highlightNode(conceptId) {
      selectedNodeId = conceptId;
      // Re-render all node sprites with new selection state
      graph.nodeThreeObject(n => createNodeSprite(n));

      // Center camera on node — retry until coordinates are available
      function tryCenter(retries) {
        const node = graph.graphData().nodes.find(n => n.id === conceptId);
        if (node && node.x != null) {
          const cam = graph.cameraPosition();
          graph.cameraPosition(cam, { x: node.x, y: node.y, z: node.z }, 800);
        } else if (retries > 0) {
          setTimeout(() => tryCenter(retries - 1), 200);
        }
      }
      tryCenter(10);
    },

    clearHighlight() {
      selectedNodeId = null;
      graph.nodeThreeObject(node => createNodeSprite(node));
    },

    refreshColors() {
      // Re-read isDark and recreate sprites without touching positions
      isDark = document.documentElement.getAttribute("data-theme") === "dark";
      graph.nodeThreeObject(n => createNodeSprite(n));
      // Update centroid line materials
      centroidMaterials.clear();
    },

    destroy() {
      cleanupGraph3D();
    },
  };
}
