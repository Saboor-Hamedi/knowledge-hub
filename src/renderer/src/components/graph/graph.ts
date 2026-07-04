/**
 * Enhanced Graph View
 * Force-directed graph visualization with filtering, clustering, and rich interactions
 */

import * as d3 from 'd3'
import { state } from '../../core/state'
import { GraphToolbar, type GraphFilters } from './graph-toolbar'
import {
  type GraphNode,
  type GraphLink,
  type GraphData,
  processGraphData,
  filterNodes,
  getNodeRadius,
  getNodeColor,
  getGroupColor
} from './graph-utils'
import './graph.css'
import './graph-toolbar.css'
import './graph-themes.css'
import '../window-header/window-header.css'

export class GraphView {
  private container: HTMLElement
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
  private g: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
  private simulation: d3.Simulation<GraphNode, GraphLink> | null = null
  private zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null
  private toolbar: GraphToolbar | null = null
  private isMaximized = false
  private isDragging = false
  private startMousePos = { x: 0, y: 0 }
  private initialModalPos = { x: 0, y: 0 }

  private graphData: GraphData | null = null
  private filteredData: GraphData | null = null
  private groupColors: Map<number, string> = new Map()
  private isLargeGraph = false
  private tickCount = 0
  private showLabels = true
  private forceStrength = -500
  private localGraphEnabled = false
  private localGraphDepth = 2
  // private pathFindMode = false
  // private pathFindStart: string | null = null
  private minimap: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
  private minimapG: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
  private minimapViewport: d3.Selection<SVGRectElement, unknown, null, undefined> | null = null
  private minimapScale = 1
  private minimapMinX = 0
  private minimapMinY = 0

  // D3 selections
  private linkSelection: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null = null
  private nodeSelection: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null = null
  private particleGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
  private activeParticleAnimations: number[] = []
  private root: HTMLElement
  private isModal = true
  private isOpen = false
  private resizeObserver: ResizeObserver | null = null

  constructor(container: HTMLElement, isModal = true) {
    this.container = container
    this.isModal = isModal
    this.root = document.createElement('div')
    this.root.className = isModal ? 'graph-modal' : 'graph-tab-view'
    this.render()
    this.container.appendChild(this.root)

    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize()
    })

    const content = this.root.querySelector('.graph-modal__content') as HTMLElement
    if (content) {
      this.resizeObserver.observe(content)
    }

    // Bind Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.root.classList.contains('is-visible')) {
        this.close()
      }
    })

    // Listen for global theme changes to reset graph theme
    window.addEventListener('knowledge-hub:theme-changed', () => {
      if (state.settings?.graphTheme) {
        this.handleThemeChange(state.settings.graphTheme)
      }
    })
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="graph-modal__content" style="${this.isModal ? '' : 'width: 100%; height: 100%; top: 0; left: 0; transform: none; border-radius: 0; box-shadow: none;'}">
        <div class="window-header" style="cursor: move; ${this.isModal ? '' : 'display: none;'}">
          <div class="window-header__brand">
            <span class="window-header__title">Vault Graph</span>
            <div id="graph-stats" class="graph-modal__stats"></div>
          </div>
          <div class="window-header__controls">
            <button class="wh-btn wh-minimize" id="graph-minimize" title="Minimize" style="-webkit-app-region: no-drag;">
              <svg width="12" height="1" viewBox="0 0 12 1" fill="currentColor">
                <rect width="12" height="1"></rect>
              </svg>
            </button>
            <button class="wh-btn wh-maximize" id="graph-maximize" title="Maximize" style="-webkit-app-region: no-drag;">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2">
                <rect x="1" y="1" width="10" height="10"></rect>
              </svg>
            </button>
            <button class="wh-btn wh-close" id="graph-close" title="Close (Esc)" style="-webkit-app-region: no-drag;">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
              </svg>
            </button>
          </div>
        </div>

      <div class="graph-modal__toolbar" id="graph-toolbar"></div>
      <div class="graph-modal__view-area">
        <div class="graph-modal__canvas" id="graph-canvas"></div>
        <div class="graph-modal__side-panels">
          <div class="graph-modal__minimap" id="graph-minimap"></div>
          <div class="graph-modal__legend" id="graph-legend"></div>
        </div>
      </div>
    </div>
  `

    this.root.querySelector('#graph-close')?.addEventListener('click', () => this.close())
    this.root.querySelector('#graph-minimize')?.addEventListener('click', () => this.close())
    this.root
      .querySelector('#graph-maximize')
      ?.addEventListener('click', () => this.toggleMaximize())

    const header = this.root.querySelector('.window-header') as HTMLElement
    const content = this.root.querySelector('.graph-modal__content') as HTMLElement

    header.addEventListener('mousedown', (e) => {
      if (this.isMaximized) return
      this.isDragging = true
      this.startMousePos = { x: e.clientX, y: e.clientY }
      const rect = content.getBoundingClientRect()
      this.initialModalPos = { x: rect.left, y: rect.top }
      header.classList.add('dragging')
      content.classList.add('is-dragging')
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.startMousePos.x
      const dy = e.clientY - this.startMousePos.y

      // Use absolute coordinates since position is now absolute
      content.style.left = `${this.initialModalPos.x + dx}px`
      content.style.top = `${this.initialModalPos.y + dy}px`
      content.style.transform = 'scale(1)' // Keep scale at 1 while dragging
    })

    window.addEventListener('mouseup', () => {
      this.isDragging = false
      header.classList.remove('dragging')
      content.classList.remove('is-dragging')
    })

    header.addEventListener('dblclick', () => {
      this.toggleMaximize()
    })

    // Initialize toolbar
    const toolbarContainer = this.root.querySelector('#graph-toolbar') as HTMLElement
    if (toolbarContainer) {
      this.toolbar = new GraphToolbar(toolbarContainer, {
        isModal: this.isModal,
        onSearch: (query) => this.handleSearch(query),
        onFilterChange: (filters) => this.handleFilterChange(filters),
        onZoomIn: () => this.handleZoom(1.3),
        onZoomOut: () => this.handleZoom(0.7),
        onZoomReset: () => this.handleZoomReset(),
        onToggleLabels: (show) => {
          this.showLabels = show
          this.renderGraph()
        },
        onForceStrengthChange: (strength) => {
          this.forceStrength = -strength
          this.simulation?.force(
            'charge',
            d3.forceManyBody<GraphNode>().strength(this.forceStrength).distanceMax(500)
          )
          this.simulation?.alpha(0.3).restart()
        },
        onDepthChange: (depth) => {
          this.localGraphDepth = depth
          if (this.localGraphEnabled) this.handleFilterChange(this.getFilters())
        },
        onToggleLocalGraph: (enabled) => {
          this.localGraphEnabled = enabled
          this.handleFilterChange(this.getFilters())
        },
        onThemeChange: (theme) => this.handleThemeChange(theme),
        onExport: (format) => this.exportGraph(format),
        onDropdownOpen: () => {}
      })

      if (state.settings?.graphTheme) {
        this.toolbar.setActiveTheme(state.settings.graphTheme)
      }
    }
  }

  async open(): Promise<void> {
    if (this.isOpen && !this.isModal) {
      // If already open, just wake up the simulation
      this.simulation?.alpha(0.3).restart()
      return
    }

    if (this.isModal) {
      this.root.classList.add('is-visible')
    }
    this.isOpen = true

    if (state.settings?.graphTheme) {
      this.handleThemeChange(state.settings.graphTheme)
    }
    await this.initGraph()

    // Warm up the simulation and then fit to view
    const initialAlpha = this.isLargeGraph ? 0.15 : 1
    setTimeout(() => {
      this.zoomToFit(1000)
    }, this.isLargeGraph ? 100 : 300)

    // Ensure it's active (lower alpha for large graphs to avoid CPU thrash)
    this.simulation?.alpha(initialAlpha).restart()
  }

  close(): void {
    if (this.isModal) {
      this.root.classList.remove('is-visible')
    }
    this.isOpen = false
    if (this.simulation) {
      this.simulation.stop()
    }
  }

  private handleResize(): void {
    if (!this.isOpen || !this.simulation || !this.svg) return

    const canvas = this.root.querySelector('#graph-canvas') as HTMLElement
    if (!canvas) return

    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return

    // Resize SVG
    this.svg.attr('width', width).attr('height', height)

    // Update zoom extent
    this.zoom?.extent([
      [0, 0],
      [width, height]
    ])

    // Update force center
    this.simulation.force('center', d3.forceCenter(width / 2, height / 2))
    this.simulation.force('x', d3.forceX(width / 2).strength(0.05))
    this.simulation.force('y', d3.forceY(height / 2).strength(0.05))

    // Warm restart
    this.simulation.alpha(0.1).restart()

    // Update other UI elements
    this.updateMinimap()
  }

  private async initGraph(): Promise<void> {
    const canvas = this.root.querySelector('#graph-canvas') as HTMLElement
    if (!canvas) return

    // Ensure layout is ready
    if (!canvas.clientWidth || !canvas.clientHeight) {
      // Wait for next frame
      await new Promise((resolve) => requestAnimationFrame(resolve))
      // Check again, if still 0, wait a bit longer (e.g. for transitions)
      if (!canvas.clientWidth || !canvas.clientHeight) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    const width = canvas.clientWidth || 800
    const height = canvas.clientHeight || 600

    // Clear previous
    canvas.innerHTML = ''

    // Check for API availability
    if (!window.api.getGraph) {
      this.showError('Graph API not found. Please restart the application.')
      return
    }

    try {
      // Fetch data
      const graphData = await window.api.getGraph()
      const allNotes = state.notes

      if (!graphData || !allNotes) {
        this.showError('No notes found in vault.')
        return
      }

      // Bulk load note contents in a single IPC call
      const noteIds = allNotes.filter((n) => n.type !== 'folder').map((n) => n.id)
      const contentRecord = await window.api.graphLoadContents(noteIds)
      const noteContents = new Map(Object.entries(contentRecord))

      this.isLargeGraph = noteIds.length > 500

      // Process graph data (skip expensive code dependency analysis for performance)
      this.graphData = processGraphData(allNotes, graphData.links, noteContents, state.activeId, false)
      this.filteredData = this.graphData

      // Generate group colors
      const uniqueGroups = new Set(this.graphData.nodes.map((n) => n.group))
      uniqueGroups.forEach((group, index) => {
        this.groupColors.set(group, getGroupColor(index))
      })

      // Update toolbar with available filters
      if (this.toolbar) {
        this.toolbar.setAvailableTags(Array.from(this.graphData.tags.keys()))
        this.toolbar.setAvailableFolders(Array.from(this.graphData.clusters.keys()))
      }

      // Render legend
      this.renderLegend()

      // Initialize D3
      this.initD3(canvas, width, height)

      // Update stats
      this.updateStats()
      this.updateMinimap()
    } catch (e) {
      console.error('Failed to load graph data', e)
      this.showError('Failed to load graph data.')
    }
  }

  private initD3(canvas: HTMLElement, width: number, height: number): void {
    // Create SVG
    this.svg = d3
      .select(canvas)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('class', 'graph-svg')

    // SVG definitions for markers, filters and gradients
    const defs = this.svg.append('defs')

    // Standard Radial Gradient for 3D sphere look
    const radialGrad = defs
      .append('radialGradient')
      .attr('id', 'node-gradient')
      .attr('cx', '35%')
      .attr('cy', '35%')
      .attr('r', '60%')

    radialGrad.append('stop').attr('offset', '0%').attr('stop-color', 'rgba(255, 255, 255, 0.45)')
    radialGrad.append('stop').attr('offset', '40%').attr('stop-color', 'rgba(255, 255, 255, 0.1)')
    radialGrad.append('stop').attr('offset', '100%').attr('stop-color', 'rgba(0, 0, 0, 0.3)')

    if (!this.isLargeGraph) {
      const filter = defs
        .append('filter')
        .attr('id', 'glow')
        .attr('x', '-100%')
        .attr('y', '-100%')
        .attr('width', '300%')
        .attr('height', '300%')

      filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
      const feMerge = filter.append('feMerge')
      feMerge.append('feMergeNode').attr('in', 'blur')
      feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

      const activeGlow = defs
        .append('filter')
        .attr('id', 'active-node-glow')
        .attr('x', '-200%')
        .attr('y', '-200%')
        .attr('width', '500%')
        .attr('height', '500%')
      activeGlow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
      activeGlow
        .append('feColorMatrix')
        .attr('in', 'blur')
        .attr('type', 'matrix')
        .attr('values', '0 0 0 0 0.498  0 0 0 0 0.655  0 0 0 0 1  0 0 0 1 0')
      const activeMerge = activeGlow.append('feMerge')
      activeMerge.append('feMergeNode')
      activeMerge.append('feMergeNode').attr('in', 'SourceGraphic')

      const lightingFilter = defs.append('filter').attr('id', 'sphere-lighting')

      const diffuse = lightingFilter
        .append('feDiffuseLighting')
        .attr('in', 'SourceGraphic')
        .attr('result', 'diffuse')
        .attr('lighting-color', 'white')

      diffuse.append('feDistantLight').attr('azimuth', '45').attr('elevation', '45')

      const specular = lightingFilter
        .append('feSpecularLighting')
        .attr('in', 'SourceGraphic')
        .attr('result', 'specular')
        .attr('specularExponent', '20')
        .attr('lighting-color', 'white')

      specular.append('feDistantLight').attr('azimuth', '45').attr('elevation', '45')

      lightingFilter
        .append('feComposite')
        .attr('in', 'SourceGraphic')
        .attr('in2', 'diffuse')
        .attr('operator', 'arithmetic')
        .attr('k1', '1')
        .attr('k2', '0')
        .attr('k3', '0')
        .attr('k4', '0')

      lightingFilter
        .append('feComposite')
        .attr('in', 'specular')
        .attr('operator', 'arithmetic')
        .attr('k1', '0')
        .attr('k2', '1')
        .attr('k3', '1')
        .attr('k4', '0')
    }

    // Arrow marker for directed links
    defs
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -2 5 4')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 3)
      .attr('markerHeight', 3)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-2L5,0L0,2')
      .attr('fill', 'var(--text-soft)')
      .attr('opacity', 0.6)

    // Highlighted arrow marker (for hover state)
    defs
      .append('marker')
      .attr('id', 'arrow-highlighted')
      .attr('viewBox', '0 -2 5 4')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 3)
      .attr('markerHeight', 3)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-2L5,0L0,2')
      .attr('fill', 'var(--primary)')

    // Main group for zoom/pan
    this.g = this.svg.append('g').attr('class', 'graph-main-group')

    // Zoom behavior
    this.zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        this.g?.attr('transform', event.transform)
        // Perform a lightweight viewport-only update to avoid flickering
        this.updateMinimapViewport()
      })

    this.svg.call(this.zoom)

    // Initialize simulation
    this.initSimulation(width, height)

    // Render graph
    this.renderGraph()
  }

  private initSimulation(width: number, height: number): void {
    if (!this.filteredData) return

    this.simulation = d3
      .forceSimulation<GraphNode, GraphLink>(this.filteredData.nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(this.filteredData.links)
          .id((d) => d.id)
          .distance(50)
          .strength(0.15)
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength(this.forceStrength).distanceMax(500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collision',
        d3.forceCollide<GraphNode>().radius((d) => getNodeRadius(d) + 5)
      )
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))

    this.simulation?.on('tick', () => this.tick())
    if (this.isLargeGraph) {
      this.simulation.alphaMin(0.01).on('end', () => this.simulation?.stop())
    }
  }

  private renderGraph(): void {
    if (!this.g || !this.filteredData) return

    // Clear previous
    this.g.selectAll('.links').remove()
    this.g.selectAll('.nodes').remove()
    this.g.selectAll('.particles').remove()

    // Links
    const linkGroup = (this.g as any).append('g').attr('class', 'links')
    this.linkSelection = (linkGroup as any)
      .selectAll('line')
      .data(this.filteredData.links)
      .enter()
      .append('line')
      .attr('class', (d: any) => `link ${d.bidirectional ? 'link--bidirectional' : ''}`)
      .attr('stroke-width', (d: any) => (d.bidirectional ? 2 : 1))
      .attr('marker-end', (d: any) => (d.bidirectional ? '' : 'url(#arrow)'))

    // Nodes
    const nodeGroup = (this.g as any).append('g').attr('class', 'nodes')
    this.nodeSelection = (nodeGroup as any)
      .selectAll('g')
      .data(this.filteredData.nodes)
      .enter()
      .append('g')
      .attr('class', (d: any) => {
        let classes = 'node'
        if (d.isActive) classes += ' node--active'
        if (d.isOrphan) classes += ' node--orphan'
        if (d.isHub) classes += ' node--hub'
        return classes
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) =>
            this.dragStarted(event, d)
          )
          .on('drag', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) =>
            this.dragged(event, d)
          )
          .on('end', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) =>
            this.dragEnded(event, d)
          )
      )

    // Base Sphere (Shadow/Color)
    this.nodeSelection
      .append('circle')
      .attr('class', 'node-sphere-base')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', (d) => this.computeNodeColor(d))
      .style('opacity', (d) => (d.isOrphan ? 0.7 : 1))
      .style('filter', (d: any) => (d.isActive && !this.isLargeGraph ? 'url(#active-node-glow)' : 'none'))

    // Glass Highlight (Procedural 3D Overlay)
    this.nodeSelection
      .append('circle')
      .attr('class', 'node-glass-highlight')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', 'url(#node-gradient)')
      .attr('pointer-events', 'none')

    // Node labels
    this.nodeSelection
      .append('text')
      .attr('class', 'node__label')
      .attr('dx', (d) => getNodeRadius(d) + 8)
      .attr('dy', (d) => getNodeRadius(d) / 2)
      .text((d) => d.title)
      .style('display', this.showLabels ? 'block' : 'none')

    // Node interactions
    this.nodeSelection
      .on('mouseenter', (_event, d) => this.handleNodeHover(d, true))
      .on('mouseleave', (_event, d) => this.handleNodeHover(d, false))
      .on('click', (_event, d) => this.handleNodeClick(d))

    // Particle group (for animated dots on links)
    this.particleGroup = this.g.append('g').attr('class', 'particles')

    // Restart simulation
    if (this.simulation) {
      this.simulation.nodes(this.filteredData.nodes)
      const linkForce = this.simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>
      linkForce?.links(this.filteredData.links)
      this.simulation.alpha(1).restart()
    }
  }

  private tick(): void {
    if (!this.linkSelection || !this.nodeSelection) return

    this.linkSelection
      .attr('x1', (d) => (d.source as GraphNode).x || 0)
      .attr('y1', (d) => (d.source as GraphNode).y || 0)
      .attr('x2', (d) => (d.target as GraphNode).x || 0)
      .attr('y2', (d) => (d.target as GraphNode).y || 0)

    this.nodeSelection.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`)

    // Throttle minimap updates to every 5th tick for performance
    this.tickCount++
    if (this.tickCount % 5 === 0) {
      if (!this.minimapG && this.filteredData) {
        this.updateMinimap()
      } else {
        this.updateMinimapPositions()
      }
    }
  }

  private computeNodeColor(node: GraphNode): string {
    return getNodeColor(node, state.activeId, this.groupColors)
  }

  private handleNodeHover(node: GraphNode, isEntering: boolean): void {
    if (isEntering) {
      this.highlightConnections(node)
    } else {
      this.clearHighlight()
    }
  }

  private highlightConnections(node: GraphNode): void {
    if (!this.linkSelection || !this.nodeSelection || !this.filteredData) return

    const connectedIds = new Set<string>([node.id])
    const connectedLinks: GraphLink[] = []

    // Find connected nodes and links
    this.filteredData.links.forEach((link) => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id
      const targetId = typeof link.target === 'string' ? link.target : link.target.id
      if (sourceId === node.id || targetId === node.id) {
        connectedLinks.push(link)
        connectedIds.add(sourceId)
        connectedIds.add(targetId)
      }
    })

    // Dim non-connected nodes
    this.nodeSelection
      .classed('node--dimmed', (d) => !connectedIds.has(d.id))
      .classed('node--highlighted', (d) => connectedIds.has(d.id) && d.id !== node.id)

    // Highlight connected links
    this.linkSelection
      .classed('link--highlighted', (link) => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id
        const targetId = typeof link.target === 'string' ? link.target : link.target.id
        return sourceId === node.id || targetId === node.id
      })
      .attr('marker-end', (link) => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id
        const targetId = typeof link.target === 'string' ? link.target : link.target.id
        const isHighlighted = sourceId === node.id || targetId === node.id
        if ((link as GraphLink).bidirectional) return ''
        return isHighlighted ? 'url(#arrow-highlighted)' : 'url(#arrow)'
      })

    // Start particle animations on connected links
    this.startParticleAnimations(node, connectedLinks)
  }

  private startParticleAnimations(hoveredNode: GraphNode, links: GraphLink[]): void {
    if (!this.particleGroup) return

    // Clear any existing animations
    this.stopParticleAnimations()

    // Performance limits
    const MAX_TOTAL_PARTICLES = 24
    const PARTICLES_PER_LINK = 2

    // Calculate how many particles per link based on total links
    const totalLinks = links.length
    const particlesPerLink = Math.min(
      PARTICLES_PER_LINK,
      Math.max(1, Math.floor(MAX_TOTAL_PARTICLES / totalLinks))
    )

    // Skip animation entirely if too many links (performance)
    if (totalLinks > 30) {
      return
    }

    // Prepare particle data for efficient rendering
    interface ParticleData {
      source: GraphNode
      target: GraphNode
      isOutgoing: boolean
      offset: number // 0 to 1, stagger position
      speed: number // duration in ms
    }

    const particleData: ParticleData[] = []

    links.forEach((link) => {
      const source = link.source as GraphNode
      const target = link.target as GraphNode
      const isOutgoing = source.id === hoveredNode.id

      for (let i = 0; i < particlesPerLink; i++) {
        particleData.push({
          source,
          target,
          isOutgoing,
          offset: i / particlesPerLink,
          speed: 2000 + Math.random() * 500 // Slight variation
        })
      }
    })

    // Create all particles at once (batch DOM operation)
    const particles = this.particleGroup
      .selectAll('.link-particle')
      .data(particleData)
      .enter()
      .append('circle')
      .attr('class', 'link-particle')
      .attr('r', 2.5)

    // Use requestAnimationFrame for smooth, batched animation
    let startTime: number | null = null
    let animationId: number

    const animate = (timestamp: number): void => {
      if (!startTime) startTime = timestamp
      const elapsed = timestamp - startTime

      particles.each(function (this: SVGCircleElement, d) {
        const duration = d.speed
        // Calculate progress with offset for stagger effect
        const progress = (elapsed / duration + d.offset) % 1

        // Get current positions (nodes may have moved due to simulation)
        const x1 = d.source.x || 0
        const y1 = d.source.y || 0
        const x2 = d.target.x || 0
        const y2 = d.target.y || 0

        // Interpolate position based on direction
        let x: number, y: number
        if (d.isOutgoing) {
          x = x1 + (x2 - x1) * progress
          y = y1 + (y2 - y1) * progress
        } else {
          x = x2 + (x1 - x2) * progress
          y = y2 + (y1 - y2) * progress
        }

        // Update position directly (no D3 transition overhead)
        this.setAttribute('cx', String(x))
        this.setAttribute('cy', String(y))
      })

      // Continue animation loop
      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)

    // Store the animation frame ID for cleanup (use negative to distinguish)
    this.activeParticleAnimations.push(-animationId)
  }

  private stopParticleAnimations(): void {
    // Clear all pending timeouts and animation frames
    this.activeParticleAnimations.forEach((id) => {
      if (id < 0) {
        cancelAnimationFrame(-id)
      } else {
        window.clearTimeout(id)
      }
    })
    this.activeParticleAnimations = []

    // Remove all particles
    this.particleGroup?.selectAll('.link-particle').remove()
  }

  private clearHighlight(): void {
    this.nodeSelection?.classed('node--dimmed', false).classed('node--highlighted', false)
    this.linkSelection
      ?.classed('link--highlighted', false)
      .attr('marker-end', (d) => ((d as GraphLink).bidirectional ? '' : 'url(#arrow)'))
    // Stop particle animations
    this.stopParticleAnimations()
  }

  private handleNodeClick(node: GraphNode): void {
    // Normal mode - open note
    const note = state.notes.find((n) => n.id === node.id)
    if (note) {
      this.close()
      window.dispatchEvent(
        new CustomEvent('knowledge-hub:open-note', {
          detail: { id: node.id, path: note.path }
        })
      )
    }
  }

  private renderLegend(): void {
    const legend = this.root.querySelector('#graph-legend') as HTMLElement
    if (!legend) return

    legend.innerHTML = `
      <div class="graph-panel-header">
        <span class="graph-panel-title">Legend</span>
      </div>
      <div class="graph-legend__items">
        <div class="graph-legend__item">
          <div class="graph-legend__dot" style="background: var(--primary)"></div>
          <span>Active Note</span>
        </div>
        <div class="graph-legend__item">
          <div class="graph-legend__dot" style="background: #f97316"></div>
          <span>Hub (Many links)</span>
        </div>
        <div class="graph-legend__item">
          <div class="graph-legend__dot" style="background: var(--text-soft); opacity: 0.5;"></div>
          <span>Orphan Notes</span>
        </div>
        <div class="graph-legend__item">
          <div class="graph-legend__sizes">
            <div class="graph-legend__size graph-legend__size--sm"></div>
            <div class="graph-legend__size graph-legend__size--md"></div>
            <div class="graph-legend__size graph-legend__size--lg"></div>
          </div>
          <span>Frequency / Size</span>
        </div>
      </div>
    `
  }

  private updateStats(): void {
    if (!this.filteredData || !this.toolbar) return

    const nodeCount = this.filteredData.nodes.length
    const linkCount = this.filteredData.links.length
    const orphanCount = this.filteredData.nodes.filter((n) => n.isOrphan).length

    this.toolbar.setStats(nodeCount, linkCount, orphanCount)
  }

  // Control handlers
  private handleSearch(query: string): void {
    if (!this.graphData) return

    this.filteredData = filterNodes(this.graphData, {
      searchQuery: query,
      showOrphans: true,
      selectedTags: [],
      selectedFolders: []
    })

    this.renderGraph()
    this.updateStats()
  }

  private getFilters(): GraphFilters {
    return {
      searchQuery: this.toolbar?.getCurrentSearchQuery() || '',
      showOrphans: this.toolbar?.getShowOrphans() || false,
      selectedTags: this.toolbar?.getSelectedTags() || [],
      selectedFolders: this.toolbar?.getSelectedFolders() || [],
      localGraphEnabled: this.localGraphEnabled,
      localGraphDepth: this.localGraphDepth
    }
  }

  private handleFilterChange(filters: GraphFilters): void {
    if (!this.graphData) return

    this.filteredData = filterNodes(this.graphData, filters)

    this.renderGraph()
    this.updateStats()
    this.updateMinimap()

    // Re-fit when filters change (like toggling 'Local')
    setTimeout(() => this.zoomToFit(500), 50)
  }

  private handleZoom(factor: number): void {
    if (!this.svg || !this.zoom) return
    this.svg
      .transition()
      .duration(300)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(this.zoom.scaleBy as any, factor)
  }

  public zoomToFit(duration = 750): void {
    if (!this.svg || !this.zoom || !this.filteredData) return

    const canvas = this.root.querySelector('#graph-canvas') as HTMLElement
    if (!canvas) return

    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return

    const nodes = this.filteredData.nodes
    if (nodes.length === 0) return

    // Calculate bounding box of nodes
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    nodes.forEach((n) => {
      const x = n.x ?? 0
      const y = n.y ?? 0
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    })

    const graphWidth = maxX - minX || 100
    const graphHeight = maxY - minY || 100
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // Calculate scale to fit with 20% padding
    const scale = 0.8 / Math.max(graphWidth / width, graphHeight / height)
    const finalScale = Math.max(0.1, Math.min(scale, 1.5))

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(finalScale)
      .translate(-centerX, -centerY)

    if (duration > 0) {
      this.svg
        .transition()
        .duration(duration)
        .ease(d3.easeCubicInOut)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .call(this.zoom.transform as any, transform)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.svg.call(this.zoom.transform as any, transform)
    }
  }

  private handleZoomReset(): void {
    this.zoomToFit(500)
  }

  private exportGraph(format: 'svg' | 'png'): void {
    if (!this.svg) return

    const svgElement = this.svg.node()
    if (!svgElement) return

    // Clone SVG and prepare for export
    const clone = svgElement.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    // Inline styles for export
    const styles = `
      .link { stroke: #6b7280; stroke-opacity: 0.5; }
      .link--bidirectional { stroke: #7fa7ff; }
      .link--highlighted { stroke: #7fa7ff; stroke-width: 3px; }
      .node circle { stroke: #1e1e1e; stroke-width: 2px; }
      .node__label { font-family: system-ui, sans-serif; font-size: 11px; fill: #e0e0e0; }
    `
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    styleEl.textContent = styles
    clone.insertBefore(styleEl, clone.firstChild)

    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(clone)
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })

    if (format === 'svg') {
      const url = URL.createObjectURL(svgBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vault-graph-${Date.now()}.svg`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      // PNG export using canvas
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        canvas.width = img.width * 2 // 2x for retina
        canvas.height = img.height * 2
        ctx?.scale(2, 2)
        ctx?.drawImage(img, 0, 0)

        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `vault-graph-${Date.now()}.png`
            a.click()
            URL.revokeObjectURL(url)
          }
        }, 'image/png')
      }

      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)))
    }
  }

  private handleThemeChange(theme: string): void {
    const content = this.root.querySelector('#graph-canvas')
    if (content) {
      // Remove existing theme classes
      content.classList.forEach((cls) => {
        if (cls.startsWith('theme-3d-')) {
          content.classList.remove(cls)
        }
      })

      // Add new theme class
      if (theme !== 'default') {
        content.classList.add(`theme-3d-${theme}`)
      }

      // Save to settings
      if (state.settings) {
        state.settings.graphTheme = theme
        window.api.updateSettings({ graphTheme: theme }).catch(console.error)
      }

      // Update minimap colors
      this.updateMinimap()

      // Update toolbar UI
      this.toolbar?.setActiveTheme(theme)
    }
  }

  private updateMinimap(): void {
    if (!this.filteredData || !this.g) return

    const minimapContainer = this.root.querySelector('#graph-minimap') as HTMLElement
    if (!minimapContainer) return

    const validNodes = this.filteredData.nodes.filter((n) => isFinite(n.x!) && isFinite(n.y!))
    if (validNodes.length === 0) return

    // Standard dimensions matching CSS
    const totalWidth = 170
    const totalHeight = 156
    const headerHeight = 32
    const contentHeight = totalHeight - headerHeight
    const center = totalWidth / 2
    const contentCenterY = contentHeight / 2

    // Clear now that we know we have data
    minimapContainer.innerHTML = ''

    // Calculate bounds for fit
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity

    validNodes.forEach((n) => {
      minX = Math.min(minX, n.x!)
      maxX = Math.max(maxX, n.x!)
      minY = Math.min(minY, n.y!)
      maxY = Math.max(maxY, n.y!)
    })

    this.minimapMinX = minX
    this.minimapMinY = minY

    const padding = 20
    const scaleX = (totalWidth - padding * 2) / (maxX - minX || 1)
    const scaleY = (contentHeight - padding * 2) / (maxY - minY || 1)
    this.minimapScale = Math.min(scaleX, scaleY, 0.8) // Avoid huge zoom

    this.minimap = d3
      .select(minimapContainer)
      .append('div')
      .attr('class', 'graph-panel-header')
      .append('span')
      .attr('class', 'graph-panel-title')
      .text('Minimap')
      .select(function (this: HTMLElement) {
        return this.parentNode?.parentNode as HTMLElement
      })
      .append('div')
      .attr('class', 'graph-minimap__container')
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', contentHeight)
      .attr('class', 'graph-minimap__svg')

    // Add Radar Decorations
    const radar = this.minimap!.append('g').attr('class', 'minimap-decorations')

    // Crosshair lines
    radar
      .append('line')
      .attr('class', 'minimap-radar-line')
      .attr('x1', 0)
      .attr('y1', contentCenterY)
      .attr('x2', totalWidth)
      .attr('y2', contentCenterY)

    radar
      .append('line')
      .attr('class', 'minimap-radar-line')
      .attr('x1', center)
      .attr('y1', 0)
      .attr('x2', center)
      .attr('y2', contentHeight)

    // Rings centered in content
    radar
      .append('circle')
      .attr('class', 'minimap-radar-ring')
      .attr('cx', center)
      .attr('cy', contentCenterY)
      .attr('r', contentHeight / 2.5)

    radar
      .append('circle')
      .attr('class', 'minimap-radar-ring')
      .attr('cx', center)
      .attr('cy', contentCenterY)
      .attr('r', contentHeight / 2 - 4)

    this.minimapG = (this.minimap as any)
      .append('g')
      .attr('class', 'minimap-nodes-group')
      .attr('transform', `translate(${padding}, ${padding / 2})`)

    // Initial draw
    this.updateMinimapPositions()
  }

  private updateMinimapPositions(): void {
    if (!this.minimapG || !this.filteredData) return

    const nodes = this.filteredData.nodes.filter((n) => isFinite(n.x!) && isFinite(n.y!))
    if (nodes.length === 0) return

    // Recalculate bounds to keep nodes centered on minimap
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity

    nodes.forEach((n) => {
      minX = Math.min(minX, n.x!)
      maxX = Math.max(maxX, n.x!)
      minY = Math.min(minY, n.y!)
      maxY = Math.max(maxY, n.y!)
    })

    // Store current bounds for viewport calculation
    this.minimapMinX = minX
    this.minimapMinY = minY

    // Calculate dynamic scale
    const totalWidth = 170
    const totalHeight = 156
    const headerHeight = 32
    const contentHeight = totalHeight - headerHeight
    const padding = 20

    const scaleX = (totalWidth - padding * 2) / (maxX - minX || 1)
    const scaleY = (contentHeight - padding * 2) / (maxY - minY || 1)
    this.minimapScale = Math.min(scaleX, scaleY, 0.8)

    // Update links
    const links = this.minimapG.selectAll('.minimap-link').data(this.filteredData.links)

    links
      .enter()
      .append('line')
      .attr('class', 'minimap-link')
      .attr('stroke', 'var(--text-soft)')
      .attr('stroke-opacity', 0.15)
      .attr('stroke-width', 0.5)
      .merge(links as any)
      .attr('x1', (d: any) => ((d.source as GraphNode).x! - minX) * this.minimapScale)
      .attr('y1', (d: any) => ((d.source as GraphNode).y! - minY) * this.minimapScale)
      .attr('x2', (d: any) => ((d.target as GraphNode).x! - minX) * this.minimapScale)
      .attr('y2', (d: any) => ((d.target as GraphNode).y! - minY) * this.minimapScale)

    links.exit().remove()

    // Update nodes
    const minimapNodes = this.minimapG.selectAll('.minimap-node').data(this.filteredData.nodes)

    minimapNodes
      .enter()
      .append('circle')
      .attr('class', (d: any) => `minimap-node ${d.isActive ? 'is-active' : ''}`)
      .merge(minimapNodes as any)
      .attr('cx', (d: any) => (d.x! - minX) * this.minimapScale)
      .attr('cy', (d: any) => (d.y! - minY) * this.minimapScale)
      .attr('r', (d: any) => (d.isActive ? 3.5 : 2.2))
      .attr('fill', (d: any) => (d.isActive ? '#fbbf24' : 'var(--primary)'))
      .attr('fill-opacity', (d: any) => (d.isActive ? 1 : 0.6))

    minimapNodes.exit().remove()

    // Update viewport too so it stays in sync with dynamic bounds
    this.updateMinimapViewport()
  }

  private updateMinimapViewport(): void {
    if (!this.minimapViewport || !this.svg || !this.g) return

    const transform = d3.zoomTransform(this.svg.node()!)
    const canvas = this.root.querySelector('#graph-canvas') as HTMLElement
    if (!canvas) return

    const width = canvas.clientWidth
    const height = canvas.clientHeight

    // The transform translates and scales the entire group 'g'
    // To find the viewport in the coordinate space of the nodes:
    // x_node = (x_screen - transform.x) / transform.k

    const x1 = (0 - transform.x) / transform.k
    const y1 = (0 - transform.y) / transform.k
    const x2 = (width - transform.x) / transform.k
    const y2 = (height - transform.y) / transform.k

    this.minimapViewport
      .attr('x', (x1 - this.minimapMinX) * this.minimapScale)
      .attr('y', (y1 - this.minimapMinY) * this.minimapScale)
      .attr('width', (x2 - x1) * this.minimapScale)
      .attr('height', (y2 - y1) * this.minimapScale)
  }

  // Drag handlers
  private dragStarted(
    event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>,
    d: GraphNode
  ): void {
    if (!event.active) this.simulation?.alphaTarget(0.3).restart()
    d.fx = d.x
    d.fy = d.y
    d.isActive = true
    d3.select(event.sourceEvent.target).classed('grabbing', true)

    // Performance: Stop particle animations during interaction
    this.stopParticleAnimations()
  }

  private dragged(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode): void {
    d.fx = event.x
    d.fy = event.y
  }

  private dragEnded(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode): void {
    if (!event.active) this.simulation?.alphaTarget(0)
    d.fx = null
    d.fy = null
  }

  private showError(message: string): void {
    const canvas = this.root.querySelector('#graph-canvas') as HTMLElement
    if (canvas) {
      canvas.innerHTML = `
        <div class="graph-modal__error">
          <span>${message}</span>
        </div>
      `
    }
  }

  private toggleMaximize(): void {
    this.isMaximized = !this.isMaximized
    const content = this.root.querySelector('.graph-modal__content') as HTMLElement
    if (this.isMaximized) {
      this.root.classList.add('is-maximized')
      // Let CSS handle dimensions for cleaner transitions
      content.style.width = ''
      content.style.height = ''
      content.style.left = ''
      content.style.top = ''
    } else {
      this.root.classList.remove('is-maximized')
      // Reset to defaults
      content.style.width = ''
      content.style.height = ''
      content.style.left = ''
      content.style.top = ''
    }

    // Let CSS handle dimensions for cleaner transitions
    // The ResizeObserver will trigger handleResize as the dimensions change

    // Relay-out simulation if needed
    setTimeout(() => {
      this.handleResize()
    }, 400) // End of CSS transition
  }
}
