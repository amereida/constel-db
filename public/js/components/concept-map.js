// concept-map.js — grafo force-directed D3.js de conceptos
// Modo título: labels como partículas, tamaño = f(frecuencia).
// Sin negrita. forceCollide con bounding box → sin traslape.

import { state, computeConceptGraph, getThemeColor } from "../state.js";

/**
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string} [opts.sourceId]
 * @param {number} [opts.threshold=1] - min co-excerpts to show a link
 * @param {boolean} [opts.showEdges=true]
 * @param {Function} opts.onClickConcept
 * @returns {Object|null} controller
 */
export function renderConceptMap(container, opts = {}) {
  const d3 = window.d3;
  if (!d3) {
    container.innerHTML = `<p class="placeholder">D3.js no está cargado</p>`;
    return null;
  }

  const { nodes, links } = computeConceptGraph(opts.sourceId || null);
  if (!nodes.length) {
    container.innerHTML = `<p class="placeholder">Marca pasajes con conceptos para ver el mapa</p>`;
    return null;
  }

  container.innerHTML = "";
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 400;
  let currentThreshold = opts.threshold || 1;
  const allLinks = [...links]; // keep full set for threshold filtering

  // ── Font size scale (no bold, only size varies) ──
  const maxExc = Math.max(1, ...nodes.map(n => n.excerptCount));
  const maxSrc = Math.max(1, ...nodes.map(n => n.sourceCount));

  function fontSize(d) {
    const score = (d.excerptCount / maxExc) * 0.6 + (d.sourceCount / maxSrc) * 0.4;
    return Math.round(11 + score * 20); // 11px to 31px
  }

  // ── SVG ──
  const svg = d3.select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height]);

  const g = svg.append("g");
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 3])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoomBehavior);

  // ── Filter links by threshold ──
  let visibleLinks = allLinks.filter(l => l.weight >= currentThreshold);
  const maxWeight = Math.max(1, ...allLinks.map(l => l.weight));

  // ── Aristas al centroide del grupo (permanentes) ──
  const centroidG = g.append("g").attr("class", "map-centroid-links");

  // Calcular centroides de grupos
  const groupCentroids = new Map();
  function updateGroupCentroids() {
    groupCentroids.clear();
    const groups = new Map();

    for (const node of nodes) {
      if (!node.themeId) continue;
      if (!groups.has(node.themeId)) groups.set(node.themeId, []);
      groups.get(node.themeId).push(node);
    }

    for (const [themeId, groupNodes] of groups) {
      if (groupNodes.length < 2) continue;
      let cx = 0, cy = 0;
      for (const n of groupNodes) {
        cx += n.x || 0;
        cy += n.y || 0;
      }
      cx /= groupNodes.length;
      cy /= groupNodes.length;
      groupCentroids.set(themeId, { x: cx, y: cy, color: getThemeColor(themeId) });
    }
  }

  // Crear aristas al centroide
  function getCentroidLinks() {
    const links = [];
    for (const node of nodes) {
      if (!node.themeId) continue;
      const centroid = groupCentroids.get(node.themeId);
      if (centroid) {
        links.push({ node, centroid });
      }
    }
    return links;
  }

  let centroidLinks = centroidG.selectAll("line").data([]);

  // ── Links (entre nodos) ──
  const linkG = g.append("g").attr("class", "map-links-group");
  let link = linkG
    .selectAll("line")
    .data(visibleLinks)
    .join("line")
    .attr("class", "map-link")
    .attr("stroke-width", d => {
      const norm = d.weight / maxWeight;
      return Math.max(0.5, norm * 3);
    });

  // initial edge visibility
  if (opts.showEdges === false) {
    linkG.style("display", "none");
    centroidG.style("display", "none");
  }

  // ── Nodes (text only, no bold, multiline at 40 chars) ──
  const MAX_CHARS = 40;

  function wrapLabel(label) {
    if (label.length <= MAX_CHARS) return [label];
    const words = label.split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      if (current && (current + " " + word).length > MAX_CHARS) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "map-node");

  node.each(function(d) {
    const textEl = d3.select(this).append("text")
      .attr("text-anchor", "middle")
      .style("font-size", `${fontSize(d)}px`)
      .style("font-weight", "400")
      .style("fill", getThemeColor(d.themeId))
      .style("cursor", "pointer");

    const lines = wrapLabel(d.label);
    const lineH = fontSize(d) * 1.2;
    const totalH = lines.length * lineH;
    const startY = -totalH / 2 + lineH * 0.7;

    lines.forEach((line, i) => {
      textEl.append("tspan")
        .attr("x", 0)
        .attr("dy", i === 0 ? `${startY}px` : `${lineH}px`)
        .text(line);
    });
  });

  // ── Measure bounding boxes for collision (after tspan layout) ──
  const textSizes = new Map();
  node.each(function(d) {
    const textEl = this.querySelector("text");
    if (textEl) {
      const bbox = textEl.getBBox();
      textSizes.set(d.id, { w: bbox.width, h: bbox.height });
    }
  });

  // Padding around each text bounding box
  // Height is compressed to avoid vertical stacking bias
  const PAD_W = 4;
  const PAD_H = 1;
  const H_SCALE = 0.55; // compress vertical collision box

  function getBox(d) {
    const s = textSizes.get(d.id);
    if (!s) return { hw: 30, hh: 6 };
    return { hw: s.w / 2 + PAD_W, hh: s.h / 2 * H_SCALE + PAD_H };
  }

  /**
   * Rectangular collision force.
   * Prevents bounding boxes from overlapping.
   */
  function forceRectCollide() {
    let _nodes;
    const iterations = 4;

    function force() {
      for (let k = 0; k < iterations; k++) {
        for (let i = 0; i < _nodes.length; i++) {
          for (let j = i + 1; j < _nodes.length; j++) {
            const a = _nodes[i];
            const b = _nodes[j];
            const ba = getBox(a);
            const bb = getBox(b);

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const overlapX = (ba.hw + bb.hw) - Math.abs(dx);
            const overlapY = (ba.hh + bb.hh) - Math.abs(dy);

            if (overlapX > 0 && overlapY > 0) {
              // push apart along axis of least overlap
              if (overlapX < overlapY) {
                const shift = overlapX / 2 * 0.5;
                const sx = dx > 0 ? shift : -shift;
                a.x -= sx;
                b.x += sx;
              } else {
                const shift = overlapY / 2 * 0.5;
                const sy = dy > 0 ? shift : -shift;
                a.y -= sy;
                b.y += sy;
              }
            }
          }
        }
      }
    }

    force.initialize = function(nodes) { _nodes = nodes; };
    return force;
  }

  // ── Simulation ──
  const linkForce = d3.forceLink(visibleLinks)
    .id(d => d.id)
    .distance(d => {
      const norm = d.weight / maxWeight;
      return 60 * (1.5 - norm);
    })
    .strength(d => {
      const norm = d.weight / maxWeight;
      return 0.2 + norm * 0.8;
    });

  // Nodos sin links visibles → periferia
  function computeLinkedIds() {
    const ids = new Set();
    for (const l of visibleLinks) {
      ids.add(typeof l.source === "object" ? l.source.id : l.source);
      ids.add(typeof l.target === "object" ? l.target.id : l.target);
    }
    return ids;
  }
  let linkedIds = computeLinkedIds();

  // ── Fuerza de atracción al centroide del grupo (tema) ──
  function forceGroupCentroid() {
    let _nodes;
    const strength = 0.15; // ajustable

    function force(alpha) {
      // Agrupar nodos por themeId
      const groups = new Map();
      for (const node of _nodes) {
        const tid = node.themeId || "__none__";
        if (!groups.has(tid)) groups.set(tid, []);
        groups.get(tid).push(node);
      }

      // Para cada grupo, calcular centroide y atraer nodos hacia él
      for (const [tid, groupNodes] of groups) {
        if (groupNodes.length < 2) continue; // solo si hay más de un nodo

        // Calcular centroide
        let cx = 0, cy = 0;
        for (const n of groupNodes) {
          cx += n.x;
          cy += n.y;
        }
        cx /= groupNodes.length;
        cy /= groupNodes.length;

        // Atraer cada nodo hacia el centroide
        for (const n of groupNodes) {
          const dx = cx - n.x;
          const dy = cy - n.y;
          n.vx += dx * strength * alpha;
          n.vy += dy * strength * alpha;
        }
      }
    }

    force.initialize = function(nodes) { _nodes = nodes; };
    return force;
  }

  const simulation = d3.forceSimulation(nodes)
    .force("link", linkForce)
    .force("charge", d3.forceManyBody()
      .strength(d => {
        if (!linkedIds.has(d.id)) return -40;
        return -15 - fontSize(d) * 0.8;
      })
    )
    .force("center", d3.forceCenter(width / 2, height / 2).strength(0.4))
    .force("rectCollide", forceRectCollide())
    .force("groupCentroid", forceGroupCentroid())
    .force("x", d3.forceX(width / 2).strength(d => linkedIds.has(d.id) ? 0.03 : 0.01))
    .force("y", d3.forceY(height / 2).strength(d => linkedIds.has(d.id) ? 0.03 : 0.01));

  node.call(makeDrag(d3, simulation));

  // ── Selection ──
  let _selectedId = null;

  function applySelection(conceptId) {
    _selectedId = conceptId;
    // Reset all nodes to normal
    node.attr("opacity", 1);
    node.select("text")
      .style("fill", d => getThemeColor(d.themeId))
      .style("font-weight", "400")
      .style("paint-order", "stroke")
      .style("stroke", "none")
      .style("stroke-width", 0);
    link.attr("stroke-opacity", 0.4);

    if (!conceptId) return;

    // Selected node: accent outline
    node.select("text")
      .style("stroke", d => d.id === conceptId ? getThemeColor(d.themeId) : "none")
      .style("stroke-width", d => d.id === conceptId ? 0.4 : 0);

    // Brighten connected links
    link.attr("stroke-opacity", l =>
      (l.source.id === conceptId || l.target.id === conceptId) ? 0.8 : 0.4
    );
  }

  function centerOnNode(conceptId) {
    const target = nodes.find(n => n.id === conceptId);
    if (!target || target.x == null) return;
    const scale = 1.5;
    svg.transition().duration(500)
      .call(zoomBehavior.transform,
        d3.zoomIdentity
          .translate(width / 2 - target.x * scale, height / 2 - target.y * scale)
          .scale(scale)
      );
  }

  // ── Hover ──
  node.on("mouseenter", function(e, d) {
    if (_selectedId) return;
    link.attr("stroke-opacity", l =>
      (l.source.id === d.id || l.target.id === d.id) ? 0.8 : 0.1
    );
    node.attr("opacity", n =>
      n.id === d.id || links.some(l =>
        (l.source.id === d.id && l.target.id === n.id) ||
        (l.target.id === d.id && l.source.id === n.id)
      ) ? 1 : 0.25
    );
  });

  node.on("mouseleave", function() {
    if (_selectedId) { applySelection(_selectedId); return; }
    link.attr("stroke-opacity", 0.4);
    node.attr("opacity", 1);
  });

  // ── Click ──
  node.on("click", (e, d) => {
    if (opts.onClickConcept) opts.onClickConcept(d.id);
  });

  // ── Tick ──
  simulation.on("tick", () => {
    // Actualizar centroides
    updateGroupCentroids();

    // Aristas entre nodos
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    // Aristas al centroide
    centroidLinks = centroidG.selectAll("line")
      .data(getCentroidLinks())
      .join("line")
      .attr("class", "map-centroid-link")
      .attr("x1", d => d.node.x)
      .attr("y1", d => d.node.y)
      .attr("x2", d => d.centroid.x)
      .attr("y2", d => d.centroid.y)
      .attr("stroke", d => d.centroid.color)
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.3)
      .attr("stroke-dasharray", "2,2");

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  // ── Controller ──
  return {
    simulation,

    setThreshold(thresh) {
      currentThreshold = thresh;
      visibleLinks = allLinks.filter(l => l.weight >= thresh);
      linkedIds = computeLinkedIds();

      // update links (entre nodos) - NO afecta las aristas de centroide
      link = linkG.selectAll("line")
        .data(visibleLinks, d => `${typeof d.source === "object" ? d.source.id : d.source}::${typeof d.target === "object" ? d.target.id : d.target}`)
        .join("line")
        .attr("class", "map-link")
        .attr("stroke-width", d => Math.max(0.5, (d.weight / maxWeight) * 3));

      // update simulation
      linkForce.links(visibleLinks);
      simulation.alpha(0.6).restart();
    },

    setStrength(factor) {
      // factor: 0.2 (suelto) a 6.0 (muy apretado)
      linkForce
        .distance(d => {
          const norm = d.weight / maxWeight;
          return (60 * (1.5 - norm)) / factor;
        })
        .strength(d => {
          const norm = d.weight / maxWeight;
          return Math.min(1, (0.2 + norm * 0.8) * factor);
        });
      // stronger center pull with higher force
      simulation.force("center").strength(0.4 * factor);
      simulation.force("charge").strength(d => {
        const base = linkedIds.has(d.id) ? -15 - fontSize(d) * 0.8 : -40;
        return base / Math.max(0.5, factor * 0.3);
      });
      simulation.alpha(0.6).restart();
    },

    setEdgesVisible(visible) {
      linkG.style("display", visible ? null : "none");
      centroidG.style("display", visible ? null : "none");
    },

    highlightNode(conceptId) {
      applySelection(conceptId);
      if (simulation.alpha() > 0.1) {
        simulation.on("end.center", () => {
          centerOnNode(conceptId);
          simulation.on("end.center", null);
        });
      } else {
        centerOnNode(conceptId);
      }
    },

    clearHighlight() {
      applySelection(null);
    },

    refreshColors() {
      // Update text fill colors without touching layout
      node.select("text").style("fill", d => getThemeColor(d.themeId));
      if (_selectedId) applySelection(_selectedId);
    },
  };
}

function makeDrag(d3, simulation) {
  return d3.drag()
    .on("start", (e, d) => {
      if (!e.active && simulation) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (e, d) => {
      d.fx = e.x; d.fy = e.y;
    })
    .on("end", (e, d) => {
      if (!e.active && simulation) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}
