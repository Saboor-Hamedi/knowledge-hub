/**
 * Graph Utilities
 * Helper functions for graph data processing
 */

import type { NoteMeta } from '../../core/types'

export interface GraphNode {
  id: string
  title: string
  path?: string
  group: number // Cluster/folder group
  connectionCount: number
  incomingCount: number
  outgoingCount: number
  tags: string[]
  isOrphan: boolean
  isHub: boolean
  isActive: boolean
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  bidirectional: boolean
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  clusters: Map<string, string[]> // folder path -> node ids
  tags: Map<string, string[]> // tag -> node ids
}

/**
 * Extract tags from note content
 */
export function extractTags(content: string): string[] {
  const tags: string[] = []

  // Frontmatter tags: tags: [tag1, tag2] or tags: tag1, tag2
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const tagsMatch = frontmatter.match(/tags:\s*\[?(.*?)\]?\s*$/m)
    if (tagsMatch) {
      const tagStr = tagsMatch[1]
      const extracted = tagStr
        .split(',')
        .map((t) => t.trim().replace(/['"]/g, ''))
        .filter(Boolean)
      tags.push(...extracted)
    }
  }

  // Inline tags: #tag (not in code blocks)
  const inlineTagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g
  let match
  while ((match = inlineTagRegex.exec(content)) !== null) {
    if (!tags.includes(match[1])) {
      tags.push(match[1])
    }
  }

  return tags
}

/**
 * Get folder path from note path
 */
export function getFolderPath(notePath?: string): string {
  if (!notePath) return 'root'
  const parts = notePath.split('/')
  if (parts.length <= 1) return 'root'
  return parts.slice(0, -1).join('/')
}

/**
 * Generate a consistent color for a folder/group
 */
export function getGroupColor(group: number): string {
  // Use a refined HSL palette with better distribution
  const hue = (group * 137.5) % 360 // Gold angle for better distribution
  return `hsl(${hue}, 85%, 65%)`
}

/**
 * Get node color based on its properties
 */
export function getNodeColor(
  node: GraphNode,
  activeId: string | null,
  groupColors: Map<number, string>
): string {
  if (node.id === activeId) {
    return '#00ffcc' // Vibrant Cyan for active (Nexus feel)
  }
  if (node.isOrphan) {
    return '#4a4a4a' // Darker Gray for orphans
  }
  if (node.isHub) {
    return '#be00ff' // Electric Purple for hubs
  }
  // Standard connected node
  return groupColors.get(node.group) || '#4cc9f0'
}

/**
 * Get node radius based on connection count
 */
export function getNodeRadius(node: GraphNode, minRadius = 7, maxRadius = 32): number {
  const connections = node.connectionCount
  if (connections === 0) return minRadius
  // Log scale for better distribution
  const scale = Math.log(connections + 1) / Math.log(50)
  return Math.min(maxRadius, minRadius + scale * (maxRadius - minRadius))
}

/**
 * Process raw graph data into enhanced graph structure
 */
export function processGraphData(
  notes: NoteMeta[],
  links: { source: string; target: string }[],
  codeLinks: { source: string; target: string }[] = [],
  tagsRecord: Record<string, string[]> = {},
  activeId: string | null = null
): GraphData {
  const nodeMap = new Map<string, GraphNode>()
  const clusters = new Map<string, string[]>()
  const tagsMap = new Map<string, string[]>()
  const folderToGroup = new Map<string, number>()
  let groupCounter = 0

  // Create nodes
  for (const note of notes) {
    if (note.type === 'folder') continue

    const folderPath = getFolderPath(note.path)
    if (!folderToGroup.has(folderPath)) {
      folderToGroup.set(folderPath, groupCounter++)
    }

    const tags = tagsRecord[note.id] || []

    const node: GraphNode = {
      id: note.id,
      title: (note.title || note.id).replace(/\.[^/.]+$/, ''),
      path: note.path,
      group: folderToGroup.get(folderPath) || 0,
      connectionCount: 0,
      incomingCount: 0,
      outgoingCount: 0,
      tags,
      isOrphan: true,
      isHub: false,
      isActive: note.id === activeId
    }

    nodeMap.set(note.id, node)

    // Track clusters
    if (!clusters.has(folderPath)) {
      clusters.set(folderPath, [])
    }
    clusters.get(folderPath)!.push(note.id)

    // Track tags
    for (const tag of tags) {
      if (!tagsMap.has(tag)) {
        tagsMap.set(tag, [])
      }
      tagsMap.get(tag)!.push(note.id)
    }
  }

  // Build lookup maps for resolving wikilink targets
  const nodeById = new Map<string, GraphNode>()
  const nodeByTitle = new Map<string, GraphNode>()
  const nodeByTitleLower = new Map<string, GraphNode>()
  const nodeByBasename = new Map<string, GraphNode>() // New Map

  for (const node of nodeMap.values()) {
    nodeById.set(node.id, node)
    nodeById.set(node.id.toLowerCase(), node)
    if (node.title) {
      nodeByTitle.set(node.title, node)
      nodeByTitleLower.set(node.title.toLowerCase(), node)
    }
    // Populate basename map
    const basename = node.id
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '')
      .toLowerCase()
    if (basename) nodeByBasename.set(basename, node)
  }

  // Resolve a wikilink target to a node
  const resolveTarget = (target: string): GraphNode | undefined => {
    // Try exact ID match first
    if (nodeById.has(target)) return nodeById.get(target)
    // Try lowercase ID
    const lowerTarget = target.toLowerCase()
    if (nodeById.has(lowerTarget)) return nodeById.get(lowerTarget)
    // Try exact title match
    if (nodeByTitle.has(target)) return nodeByTitle.get(target)
    // Try lowercase title
    if (nodeByTitleLower.has(lowerTarget)) return nodeByTitleLower.get(lowerTarget)
    // Try with .md extension stripped (legacy)
    const withoutMd = lowerTarget.replace(/\.md$/, '')
    if (nodeById.has(withoutMd)) return nodeById.get(withoutMd)

    // Try matching basename (e.g. 'connection' -> 'connection.php')
    if (nodeByBasename.has(lowerTarget)) return nodeByBasename.get(lowerTarget)

    return undefined
  }

  // Process links and count connections
  const linkMap = new Map<string, GraphLink>()

  for (const link of links) {
    const sourceNode = nodeMap.get(link.source)
    const targetNode = resolveTarget(link.target)

    if (!sourceNode || !targetNode) continue
    // Avoid self-links
    if (sourceNode.id === targetNode.id) continue

    sourceNode.outgoingCount++
    targetNode.incomingCount++
    sourceNode.isOrphan = false
    targetNode.isOrphan = false

    // Check for bidirectional
    const forwardKey = `${sourceNode.id}->${targetNode.id}`
    const reverseKey = `${targetNode.id}->${sourceNode.id}`

    if (linkMap.has(reverseKey)) {
      linkMap.get(reverseKey)!.bidirectional = true
    } else {
      linkMap.set(forwardKey, {
        source: sourceNode.id,
        target: targetNode.id,
        bidirectional: false,
        weight: 1
      })
    }
  }

  // Process Code Dependencies
  for (const link of codeLinks) {
    const sourceNode = nodeMap.get(link.source)
    const targetNode = resolveTarget(link.target)

    if (!sourceNode || !targetNode) continue
    if (sourceNode.id === targetNode.id) continue

    const forwardKey = `${sourceNode.id}->${targetNode.id}`
    const reverseKey = `${targetNode.id}->${sourceNode.id}`

    if (!linkMap.has(forwardKey) && !linkMap.has(reverseKey)) {
      linkMap.set(forwardKey, {
        source: sourceNode.id,
        target: targetNode.id,
        bidirectional: false,
        weight: 0.5
      })
      sourceNode.outgoingCount++
      targetNode.incomingCount++
      sourceNode.isOrphan = false
      targetNode.isOrphan = false
    }
  }

  // Calculate total connections and identify hubs
  const connectionCounts: number[] = []
  for (const node of nodeMap.values()) {
    node.connectionCount = node.incomingCount + node.outgoingCount
    connectionCounts.push(node.connectionCount)
  }

  // Hub threshold: top 10% of connections
  connectionCounts.sort((a, b) => b - a)
  const hubThreshold = connectionCounts[Math.floor(connectionCounts.length * 0.1)] || 5

  for (const node of nodeMap.values()) {
    if (node.connectionCount >= hubThreshold && node.connectionCount >= 5) {
      node.isHub = true
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links: Array.from(linkMap.values()),
    clusters,
    tags: tagsMap
  }
}

/**
 * Filter nodes based on criteria
 */
export function filterNodes(
  data: GraphData,
  options: {
    searchQuery?: string
    showOrphans?: boolean
    selectedTags?: string[]
    selectedFolders?: string[]
    localGraphCenter?: string
    localGraphDepth?: number
  }
): GraphData {
  let filteredNodes = [...data.nodes]

  // Local graph filter (before other filters)
  if (options.localGraphCenter && options.localGraphDepth && options.localGraphDepth > 0) {
    const localNodes = getNodesWithinDepth(data, options.localGraphCenter, options.localGraphDepth)
    filteredNodes = filteredNodes.filter((n) => localNodes.has(n.id))
  }

  // Search filter
  if (options.searchQuery) {
    const query = options.searchQuery.toLowerCase()
    filteredNodes = filteredNodes.filter(
      (n) => n.title.toLowerCase().includes(query) || n.id.toLowerCase().includes(query)
    )
  }

  // Orphan filter
  if (options.showOrphans === false) {
    filteredNodes = filteredNodes.filter((n) => !n.isOrphan)
  }

  // Tag filter
  if (options.selectedTags && options.selectedTags.length > 0) {
    filteredNodes = filteredNodes.filter((n) =>
      n.tags.some((t) => options.selectedTags!.includes(t))
    )
  }

  // Folder filter
  if (options.selectedFolders && options.selectedFolders.length > 0) {
    const nodeIdsInFolders = new Set<string>()
    for (const folder of options.selectedFolders) {
      const ids = data.clusters.get(folder) || []
      ids.forEach((id) => nodeIdsInFolders.add(id))
    }
    filteredNodes = filteredNodes.filter((n) => nodeIdsInFolders.has(n.id))
  }

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))
  const filteredLinks = data.links.filter((l) => {
    const sourceId = typeof l.source === 'string' ? l.source : l.source.id
    const targetId = typeof l.target === 'string' ? l.target : l.target.id
    return filteredNodeIds.has(sourceId) && filteredNodeIds.has(targetId)
  })

  return {
    nodes: filteredNodes,
    links: filteredLinks,
    clusters: data.clusters,
    tags: data.tags
  }
}

/**
 * Build adjacency list from links for efficient graph traversal
 */
export function buildAdjacencyList(data: GraphData): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()

  // Initialize all nodes
  for (const node of data.nodes) {
    adjacency.set(node.id, new Set())
  }

  // Add edges (bidirectional traversal)
  for (const link of data.links) {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id
    const targetId = typeof link.target === 'string' ? link.target : link.target.id

    adjacency.get(sourceId)?.add(targetId)
    adjacency.get(targetId)?.add(sourceId)
  }

  return adjacency
}

/**
 * Get all nodes within N hops from a center node (BFS)
 */
export function getNodesWithinDepth(data: GraphData, centerId: string, depth: number): Set<string> {
  const adjacency = buildAdjacencyList(data)
  const visited = new Set<string>()
  const queue: { id: string; level: number }[] = [{ id: centerId, level: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current.id)) continue
    visited.add(current.id)

    if (current.level < depth) {
      const neighbors = adjacency.get(current.id) || new Set()
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ id: neighbor, level: current.level + 1 })
        }
      }
    }
  }

  return visited
}
