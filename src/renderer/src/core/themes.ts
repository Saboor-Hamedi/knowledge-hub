export type ThemeColors = {
  '--bg': string
  '--bg-accent': string
  '--panel': string
  '--panel-strong': string
  '--border': string
  '--border-subtle': string
  '--muted': string
  '--text': string
  '--text-strong': string
  '--text-soft': string
  '--text-muted': string
  '--primary': string
  '--primary-strong': string
  '--danger': string
  '--status': string
  '--hover': string
  '--selection': string
  '--glass-bg': string
  '--glass-border': string
  '--shadow-subtle': string
  '--shadow-strong': string
  '--syntax-keyword': string
  '--syntax-string': string
  '--syntax-comment': string
  '--syntax-number': string
  '--syntax-builtin': string
  '--syntax-type': string
  '--activity-bg'?: string
  '--sidebar-bg'?: string
  '--titlebar-bg'?: string
  '--statusbar-bg'?: string
}

export type Theme = {
  id: string
  name: string
  colors: ThemeColors
}

const darkSyntax = {
  '--syntax-keyword': '#c678dd',
  '--syntax-string': '#98c379',
  '--syntax-comment': '#5c6370',
  '--syntax-number': '#d19a66',
  '--syntax-builtin': '#e5c07b',
  '--syntax-type': '#56b6c2'
}

const lightSyntax = {
  '--syntax-keyword': '#d73a49',
  '--syntax-string': '#032f62',
  '--syntax-comment': '#6a737d',
  '--syntax-number': '#005cc5',
  '--syntax-builtin': '#6f42c1',
  '--syntax-type': '#005cc5'
}

function withSyntax(colors: Record<string, string>): ThemeColors {
  return { ...colors, ...darkSyntax } as ThemeColors
}

export const themes: Record<string, Theme> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    colors: withSyntax({
      '--bg': '#18181b',
      '--bg-accent': '#27272a',
      '--panel': '#27272a',
      '--panel-strong': '#18181b',
      '--border': '#3f3f46',
      '--border-subtle': 'rgba(255, 255, 255, 0.08)',
      '--muted': '#626a84',
      '--text': '#e2e4e9',
      '--text-strong': '#ffffff',
      '--text-soft': '#9b9fb1',
      '--text-muted': '#626a84',
      '--primary': '#6366f1',
      '--primary-strong': '#818cf8',
      '--danger': '#f43f5e',
      '--status': '#4f46e5',
      '--hover': 'rgba(56, 139, 253, 0.1)',
      '--selection': 'rgba(56, 139, 253, 0.25)',
      '--glass-bg': 'rgba(18, 20, 28, 0.7)',
      '--glass-border': 'rgba(255, 255, 255, 0.08)',
      '--shadow-subtle': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      '--shadow-strong': '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)'
    })
  },
  light: {
    id: 'light',
    name: 'Hub Light',
    colors: {
      '--bg': '#f8fafc',
      '--bg-accent': '#f1f5f9',
      '--panel': '#ffffff',
      '--panel-strong': '#fdfdfd',
      '--border': '#e2e8f0',
      '--border-subtle': 'rgba(0, 0, 0, 0.03)',
      '--muted': '#94a3b8',
      '--text': '#334155',
      '--text-strong': '#0f172a',
      '--text-soft': '#64748b',
      '--text-muted': '#94a3b8',
      '--primary': '#4f46e5',
      '--primary-strong': '#4338ca',
      '--danger': '#e11d48',
      '--status': '#4f46e5',
      '--hover': 'rgba(56, 139, 253, 0.08)',
      '--selection': 'rgba(56, 139, 253, 0.15)',
      '--glass-bg': 'rgba(255, 255, 255, 0.7)',
      '--glass-border': 'rgba(0, 0, 0, 0.08)',
      '--shadow-subtle': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
      '--shadow-strong': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      ...lightSyntax
    } as ThemeColors
  },
  githubDark: {
    id: 'githubDark',
    name: 'GitHub Dark',
    colors: withSyntax({
      '--bg': '#0d1117',
      '--bg-accent': '#161b22',
      '--panel': '#0d1117',
      '--panel-strong': '#161b22',
      '--border': '#30363d',
      '--border-subtle': 'rgba(240, 246, 252, 0.1)',
      '--muted': '#8b949e',
      '--text': '#c9d1d9',
      '--text-strong': '#f0f6fc',
      '--text-soft': '#8b949e',
      '--text-muted': '#484f58',
      '--primary': '#58a6ff',
      '--primary-strong': '#79c0ff',
      '--danger': '#f85149',
      '--status': '#1f6feb',
      '--hover': '#b1bac41f',
      '--selection': '#388bfd26',
      '--glass-bg': 'rgba(13, 17, 23, 0.8)',
      '--glass-border': 'rgba(48, 54, 61, 0.5)',
      '--shadow-subtle': '0 1px 3px rgba(0,0,0,0.12)',
      '--shadow-strong': '0 4px 12px rgba(0,0,0,0.25)'
    })
  },
  midnight: {
    id: 'midnight',
    name: 'OLED Midnight',
    colors: withSyntax({
      '--bg': '#000000',
      '--bg-accent': '#050505',
      '--panel': '#000000',
      '--panel-strong': '#080808',
      '--border': '#1a1a1a',
      '--border-subtle': 'rgba(255, 255, 255, 0.03)',
      '--muted': '#555555',
      '--text': '#e0e0e0',
      '--text-strong': '#ffffff',
      '--text-soft': '#aaaaaa',
      '--text-muted': '#555555',
      '--primary': '#a78bfa',
      '--primary-strong': '#c4b5fd',
      '--danger': '#f87171',
      '--status': '#6d28d9',
      '--hover': 'rgba(56, 139, 253, 0.1)',
      '--selection': '#388bfd26',
      '--glass-bg': 'rgba(0, 0, 0, 0.8)',
      '--glass-border': 'rgba(255, 255, 255, 0.06)',
      '--shadow-subtle': '0 0 0 1px rgba(255, 255, 255, 0.05)',
      '--shadow-strong': '0 0 40px rgba(167, 139, 250, 0.05)'
    })
  },
  oceanic: {
    id: 'oceanic',
    name: 'Oceanic Pro',
    colors: withSyntax({
      '--bg': '#0f172a',
      '--bg-accent': '#1e293b',
      '--panel': '#0f172a',
      '--panel-strong': '#1e293b',
      '--border': '#334155',
      '--border-subtle': 'rgba(56, 189, 248, 0.1)',
      '--muted': '#64748b',
      '--text': '#e2e8f0',
      '--text-strong': '#f8fafc',
      '--text-soft': '#94a3b8',
      '--text-muted': '#64748b',
      '--primary': '#0ea5e9',
      '--primary-strong': '#38bdf8',
      '--danger': '#ef4444',
      '--status': '#0284c7',
      '--hover': 'rgba(56, 139, 253, 0.1)',
      '--selection': '#388bfd26',
      '--glass-bg': 'rgba(15, 23, 42, 0.8)',
      '--glass-border': 'rgba(56, 189, 248, 0.1)',
      '--shadow-subtle': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      '--shadow-strong': '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
    })
  },
  synthwave: {
    id: 'synthwave',
    name: 'Cyberpunk 84',
    colors: withSyntax({
      '--bg': '#2b213a',
      '--bg-accent': '#261b36',
      '--panel': '#241b2f',
      '--panel-strong': '#34294f',
      '--border': '#493a5c',
      '--border-subtle': 'rgba(255, 0, 144, 0.1)',
      '--muted': '#9681b6',
      '--text': '#fffbf6',
      '--text-strong': '#ffffff',
      '--text-soft': '#d9c2f2',
      '--text-muted': '#9681b6',
      '--primary': '#ff7edb',
      '--primary-strong': '#f97e72',
      '--danger': '#fe4450',
      '--status': '#72f1b8',
      '--hover': 'rgba(56, 139, 253, 0.15)',
      '--selection': '#388bfd40',
      '--glass-bg': 'rgba(43, 33, 58, 0.8)',
      '--glass-border': 'rgba(255, 126, 219, 0.2)',
      '--shadow-subtle': '0 0 10px rgba(255, 126, 219, 0.1)',
      '--shadow-strong': '0 0 30px rgba(255, 126, 219, 0.2)'
    })
  },
  nord: {
    id: 'nord',
    name: 'Nordic Frost',
    colors: withSyntax({
      '--bg': '#2e3440',
      '--bg-accent': '#3b4252',
      '--panel': '#3b4252',
      '--panel-strong': '#434c5e',
      '--border': '#4c566a',
      '--border-subtle': 'rgba(216, 222, 233, 0.1)',
      '--muted': '#d8dee9',
      '--text': '#eceff4',
      '--text-strong': '#ffffff',
      '--text-soft': '#e5e9f0',
      '--text-muted': '#d8dee9',
      '--primary': '#88c0d0',
      '--primary-strong': '#8fbcbb',
      '--danger': '#bf616a',
      '--status': '#5e81ac',
      '--hover': 'rgba(56, 139, 253, 0.15)',
      '--selection': '#388bfd40',
      '--glass-bg': 'rgba(46, 52, 64, 0.8)',
      '--glass-border': 'rgba(136, 192, 208, 0.1)',
      '--shadow-subtle': '0 1px 3px rgba(0,0,0,0.1)',
      '--shadow-strong': '0 4px 12px rgba(0,0,0,0.2)'
    })
  },
  dracula: {
    id: 'dracula',
    name: 'Dracula Plus',
    colors: withSyntax({
      '--bg': '#282a36',
      '--bg-accent': '#21222c',
      '--panel': '#282a36',
      '--panel-strong': '#343746',
      '--border': '#44475a',
      '--border-subtle': 'rgba(248, 248, 242, 0.1)',
      '--muted': '#6272a4',
      '--text': '#f8f8f2',
      '--text-strong': '#ffffff',
      '--text-soft': '#f8f8f2',
      '--text-muted': '#6272a4',
      '--primary': '#bd93f9',
      '--primary-strong': '#ff79c6',
      '--danger': '#ff5555',
      '--status': '#8be9fd',
      '--hover': 'rgba(56, 139, 253, 0.15)',
      '--selection': '#388bfd40',
      '--glass-bg': 'rgba(40, 42, 54, 0.8)',
      '--glass-border': 'rgba(189, 147, 249, 0.1)',
      '--shadow-subtle': '0 2px 4px rgba(0,0,0,0.1)',
      '--shadow-strong': '0 8px 16px rgba(0,0,0,0.2)'
    })
  },
  lucy: {
    id: 'lucy',
    name: 'Lucy',
    colors: withSyntax({
      '--bg': '#161616',
      '--bg-accent': '#1b1b1b',
      '--panel': '#161616',
      '--panel-strong': '#202020',
      '--border': '#2a2a2a',
      '--border-subtle': 'rgba(255, 121, 198, 0.1)',
      '--muted': '#666666',
      '--text': '#fcfcfc',
      '--text-strong': '#ffffff',
      '--text-soft': '#bbbbbb',
      '--text-muted': '#666666',
      '--primary': '#ff79c6',
      '--primary-strong': '#ff92df',
      '--danger': '#ff5555',
      '--status': '#bd93f9',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(22, 22, 22, 0.8)',
      '--glass-border': 'rgba(255, 121, 198, 0.15)',
      '--shadow-subtle': '0 4px 6px rgba(0,0,0,0.2)',
      '--shadow-strong': '0 10px 20px rgba(0,0,0,0.4)'
    })
  },
  cyberpunk2077: {
    id: 'cyberpunk2077',
    name: 'Cyberpunk 2077',
    colors: withSyntax({
      '--bg': '#050511',
      '--bg-accent': '#0a0a1a',
      '--panel': '#0a0a1a',
      '--panel-strong': '#101020',
      '--border': '#222233',
      '--border-subtle': 'rgba(243, 230, 0, 0.1)',
      '--muted': '#7a7a7a',
      '--text': '#00f0ff',
      '--text-strong': '#ffffff',
      '--text-soft': '#00f0ff',
      '--text-muted': '#7a7a7a',
      '--primary': '#f3e600',
      '--primary-strong': '#00f0ff',
      '--danger': '#ff003c',
      '--status': '#00f0ff',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(5, 5, 17, 0.9)',
      '--glass-border': 'rgba(34, 34, 51, 0.5)',
      '--shadow-subtle': '0 0 10px rgba(0, 0, 0, 0.2)',
      '--shadow-strong': '0 0 30px rgba(0, 240, 255, 0.1)'
    })
  },
  pitchBlack: {
    id: 'pitchBlack',
    name: 'Pitch Black',
    colors: withSyntax({
      '--bg': '#000000',
      '--bg-accent': '#000000',
      '--panel': '#000000',
      '--panel-strong': '#000000',
      '--border': '#222222',
      '--border-subtle': 'rgba(255, 255, 255, 0.05)',
      '--muted': '#444444',
      '--text': '#ffffff',
      '--text-strong': '#ffffff',
      '--text-soft': '#cccccc',
      '--text-muted': '#444444',
      '--primary': '#ffffff',
      '--primary-strong': '#cccccc',
      '--danger': '#ff0000',
      '--status': '#ffffff',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(0, 0, 0, 1)',
      '--glass-border': 'rgba(255, 255, 255, 0.1)',
      '--shadow-subtle': '0 0 0 1px #222222',
      '--shadow-strong': '0 0 0 1px #333333'
    })
  },
  deepdark: {
    id: 'deepdark',
    name: 'Deepdark Material',
    colors: withSyntax({
      '--bg': '#18181b',
      '--bg-accent': '#27272a',
      '--panel': '#27272a',
      '--panel-strong': '#18181b',
      '--border': '#3f3f46',
      '--border-subtle': 'rgba(255, 255, 255, 0.08)',
      '--muted': '#555555',
      '--text': '#e0e0e0',
      '--text-strong': '#ffffff',
      '--text-soft': '#aaaaaa',
      '--text-muted': '#555555',
      '--primary': '#00e5ff',
      '--primary-strong': '#1de9b6',
      '--danger': '#ff1744',
      '--status': '#00e5ff',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(17, 17, 17, 0.85)',
      '--glass-border': 'rgba(0, 229, 255, 0.1)',
      '--shadow-subtle': '0 4px 6px rgba(0,0,0,0.3)',
      '--shadow-strong': '0 10px 30px rgba(0,0,0,0.5)'
    })
  },
  popnlock: {
    id: 'popnlock',
    name: 'Pop N\u2019 Lock',
    colors: withSyntax({
      '--bg': '#2b2d3a',
      '--bg-accent': '#21232d',
      '--panel': '#2b2d3a',
      '--panel-strong': '#36394a',
      '--border': '#444b6a',
      '--border-subtle': 'rgba(247, 118, 142, 0.1)',
      '--muted': '#565f89',
      '--text': '#a9b1d6',
      '--text-strong': '#ffffff',
      '--text-soft': '#787c99',
      '--text-muted': '#565f89',
      '--primary': '#f7768e',
      '--primary-strong': '#ff9e64',
      '--danger': '#f7768e',
      '--status': '#bb9af7',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(43, 45, 58, 0.8)',
      '--glass-border': 'rgba(247, 118, 142, 0.15)',
      '--shadow-subtle': '0 2px 5px rgba(0,0,0,0.2)',
      '--shadow-strong': '0 10px 25px rgba(0,0,0,0.4)'
    })
  },
  sapphire: {
    id: 'sapphire',
    name: 'Sapphire Theme',
    colors: withSyntax({
      '--bg': '#0f1419',
      '--bg-accent': '#121920',
      '--panel': '#0f1419',
      '--panel-strong': '#171e26',
      '--border': '#232d38',
      '--border-subtle': 'rgba(45, 90, 247, 0.1)',
      '--muted': '#5c6773',
      '--text': '#e6edf3',
      '--text-strong': '#ffffff',
      '--text-soft': '#919eb1',
      '--text-muted': '#5c6773',
      '--primary': '#2d5af7',
      '--primary-strong': '#4e7bff',
      '--danger': '#f85149',
      '--status': '#2d5af7',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(15, 20, 25, 0.8)',
      '--glass-border': 'rgba(45, 90, 247, 0.15)',
      '--shadow-subtle': '0 2px 8px rgba(0,0,0,0.3)',
      '--shadow-strong': '0 12px 32px rgba(0,0,0,0.5)'
    })
  },
  peacock: {
    id: 'peacock',
    name: 'Peacock',
    colors: withSyntax({
      '--bg': '#0d1912',
      '--bg-accent': '#112118',
      '--panel': '#0d1912',
      '--panel-strong': '#152b1e',
      '--border': '#1e3d2b',
      '--border-subtle': 'rgba(0, 255, 208, 0.05)',
      '--muted': '#4a6b5a',
      '--text': '#e0f2f1',
      '--text-strong': '#ffffff',
      '--text-soft': '#8bbda5',
      '--text-muted': '#4a6b5a',
      '--primary': '#00ffd0',
      '--primary-strong': '#5effe1',
      '--danger': '#ff5252',
      '--status': '#00ffd0',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(13, 25, 18, 0.85)',
      '--glass-border': 'rgba(0, 255, 208, 0.1)',
      '--shadow-subtle': '0 4px 10px rgba(0,0,0,0.4)',
      '--shadow-strong': '0 12px 40px rgba(0,0,0,0.6)'
    })
  },
  winter: {
    id: 'winter',
    name: 'Winter',
    colors: withSyntax({
      '--bg': '#1b2b34',
      '--bg-accent': '#22343f',
      '--panel': '#1b2b34',
      '--panel-strong': '#2c404d',
      '--border': '#3e515d',
      '--border-subtle': 'rgba(102, 153, 204, 0.1)',
      '--muted': '#65737e',
      '--text': '#d8dee9',
      '--text-strong': '#ffffff',
      '--text-soft': '#abb2bf',
      '--text-muted': '#65737e',
      '--primary': '#6699cc',
      '--primary-strong': '#5fb3b3',
      '--danger': '#ec5f67',
      '--status': '#6699cc',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(27, 43, 52, 0.8)',
      '--glass-border': 'rgba(102, 153, 204, 0.15)',
      '--shadow-subtle': '0 2px 6px rgba(0,0,0,0.2)',
      '--shadow-strong': '0 15px 35px rgba(0,0,0,0.3)'
    })
  },
  onedark: {
    id: 'onedark',
    name: 'One Dark Pro',
    colors: withSyntax({
      '--bg': '#282c34',
      '--bg-accent': '#21252b',
      '--panel': '#282c34',
      '--panel-strong': '#2c313a',
      '--border': '#3e4451',
      '--border-subtle': 'rgba(97, 175, 239, 0.1)',
      '--muted': '#5c6370',
      '--text': '#abb2bf',
      '--text-strong': '#ffffff',
      '--text-soft': '#828997',
      '--text-muted': '#5c6370',
      '--primary': '#61afef',
      '--primary-strong': '#c678dd',
      '--danger': '#e06c75',
      '--status': '#61afef',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(40, 44, 52, 0.8)',
      '--glass-border': 'rgba(97, 175, 239, 0.15)',
      '--shadow-subtle': '0 4px 6px rgba(0,0,0,0.15)',
      '--shadow-strong': '0 10px 20px rgba(0,0,0,0.25)'
    })
  },
  synthwave84: {
    id: 'synthwave84',
    name: 'Synthwave \u201984',
    colors: withSyntax({
      '--bg': '#262335',
      '--bg-accent': '#241b2f',
      '--panel': '#262335',
      '--panel-strong': '#34294f',
      '--border': '#ff7edb',
      '--border-subtle': 'rgba(255, 126, 219, 0.2)',
      '--muted': '#848bb2',
      '--text': '#ffffff',
      '--text-strong': '#ffffff',
      '--text-soft': '#b6b1b1',
      '--text-muted': '#848bb2',
      '--primary': '#ff7edb',
      '--primary-strong': '#fedb88',
      '--danger': '#fe4450',
      '--status': '#72f1b8',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(38, 35, 53, 0.8)',
      '--glass-border': 'rgba(255, 126, 219, 0.25)',
      '--shadow-subtle': '0 0 15px rgba(255, 126, 219, 0.2)',
      '--shadow-strong': '0 0 40px rgba(255, 126, 219, 0.3)'
    })
  },
  atomone: {
    id: 'atomone',
    name: 'Atom One Dark',
    colors: withSyntax({
      '--bg': '#282c34',
      '--bg-accent': '#21252b',
      '--panel': '#282c34',
      '--panel-strong': '#181a1f',
      '--border': '#181a1f',
      '--border-subtle': 'rgba(82, 139, 255, 0.05)',
      '--muted': '#5c6370',
      '--text': '#abb2bf',
      '--text-strong': '#ffffff',
      '--text-soft': '#9da5b4',
      '--text-muted': '#5c6370',
      '--primary': '#528bff',
      '--primary-strong': '#2979ff',
      '--danger': '#ff1414',
      '--status': '#528bff',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(40, 44, 52, 0.8)',
      '--glass-border': 'rgba(82, 139, 255, 0.15)',
      '--shadow-subtle': '0 2px 4px rgba(0,0,0,0.2)',
      '--shadow-strong': '0 10px 20px rgba(0,0,0,0.3)'
    })
  },
  nightowl: {
    id: 'nightowl',
    name: 'Night Owl',
    colors: withSyntax({
      '--bg': '#011627',
      '--bg-accent': '#01111d',
      '--panel': '#011627',
      '--panel-strong': '#0b2942',
      '--border': '#122d42',
      '--border-subtle': 'rgba(130, 170, 255, 0.1)',
      '--muted': '#637777',
      '--text': '#d6deeb',
      '--text-strong': '#ffffff',
      '--text-soft': '#b2ccd6',
      '--text-muted': '#637777',
      '--primary': '#82aaff',
      '--primary-strong': '#addb67',
      '--danger': '#ef5350',
      '--status': '#82aaff',
      '--hover': 'rgba(0, 240, 255, 0.15)',
      '--selection': '#00f0ff40',
      '--glass-bg': 'rgba(1, 22, 39, 0.8)',
      '--glass-border': 'rgba(130, 170, 255, 0.15)',
      '--shadow-subtle': '0 5px 10px rgba(0,0,0,0.3)',
      '--shadow-strong': '0 15px 35px rgba(0,0,0,0.5)'
    })
  },
  ubuntuYaru: {
    id: 'ubuntuYaru',
    name: 'Ubuntu Yaru',
    colors: withSyntax({
      '--bg': '#2C001E',
      '--bg-accent': '#3D0029',
      '--panel': '#2C001E',
      '--panel-strong': '#1C0013',
      '--border': '#4c4c4c',
      '--border-subtle': 'rgba(233, 84, 32, 0.15)',
      '--muted': '#888888',
      '--text': '#fcfcfc',
      '--text-strong': '#ffffff',
      '--text-soft': '#d3d3d3',
      '--text-muted': '#888888',
      '--primary': '#E95420',
      '--primary-strong': '#FF7A49',
      '--danger': '#c7162b',
      '--status': '#E95420',
      '--hover': 'rgba(233, 84, 32, 0.15)',
      '--selection': 'rgba(233, 84, 32, 0.3)',
      '--glass-bg': 'rgba(44, 0, 30, 0.9)',
      '--glass-border': 'rgba(233, 84, 32, 0.2)',
      '--shadow-subtle': '0 2px 5px rgba(0,0,0,0.2)',
      '--shadow-strong': '0 8px 16px rgba(0,0,0,0.4)',
      '--activity-bg': '#2C001E',
      '--sidebar-bg': '#2C001E',
      '--titlebar-bg': '#2C001E',
      '--statusbar-bg': '#2C001E'
    })
  },
  popOS: {
    id: 'popOS',
    name: 'Pop!_OS',
    colors: withSyntax({
      '--bg': '#333130',
      '--bg-accent': '#262423',
      '--panel': '#2a2827',
      '--panel-strong': '#201e1d',
      '--border': '#484544',
      '--border-subtle': 'rgba(72, 185, 199, 0.1)',
      '--muted': '#898685',
      '--text': '#fdfaf8',
      '--text-strong': '#ffffff',
      '--text-soft': '#d9d6d5',
      '--text-muted': '#898685',
      '--primary': '#48b9c7',
      '--primary-strong': '#fbc02d',
      '--danger': '#e26a6a',
      '--status': '#48b9c7',
      '--hover': 'rgba(72, 185, 199, 0.15)',
      '--selection': 'rgba(72, 185, 199, 0.25)',
      '--glass-bg': 'rgba(38, 36, 35, 0.85)',
      '--glass-border': 'rgba(72, 185, 199, 0.2)',
      '--shadow-subtle': '0 4px 6px rgba(0,0,0,0.15)',
      '--shadow-strong': '0 12px 24px rgba(0,0,0,0.3)'
    })
  },
  catppuccinMocha: {
    id: 'catppuccinMocha',
    name: 'Catppuccin Mocha',
    colors: withSyntax({
      '--bg': '#1e1e2e',
      '--bg-accent': '#181825',
      '--panel': '#181825',
      '--panel-strong': '#11111b',
      '--border': '#313244',
      '--border-subtle': 'rgba(137, 180, 250, 0.1)',
      '--muted': '#6c7086',
      '--text': '#cdd6f4',
      '--text-strong': '#ffffff',
      '--text-soft': '#bac2de',
      '--text-muted': '#7f849c',
      '--primary': '#cba6f7',
      '--primary-strong': '#89b4fa',
      '--danger': '#f38ba8',
      '--status': '#a6e3a1',
      '--hover': 'rgba(203, 166, 247, 0.15)',
      '--selection': 'rgba(137, 180, 250, 0.25)',
      '--glass-bg': 'rgba(30, 30, 46, 0.85)',
      '--glass-border': 'rgba(203, 166, 247, 0.15)',
      '--shadow-subtle': '0 2px 4px rgba(0,0,0,0.2)',
      '--shadow-strong': '0 8px 16px rgba(0,0,0,0.4)'
    })
  },
  tokyoNight: {
    id: 'tokyoNight',
    name: 'Tokyo Night',
    colors: withSyntax({
      '--bg': '#1a1b26',
      '--bg-accent': '#16161e',
      '--panel': '#24283b',
      '--panel-strong': '#1a1b26',
      '--border': '#414868',
      '--border-subtle': 'rgba(122, 162, 247, 0.1)',
      '--muted': '#565f89',
      '--text': '#a9b1d6',
      '--text-strong': '#c0caf5',
      '--text-soft': '#9aa5ce',
      '--text-muted': '#565f89',
      '--primary': '#7aa2f7',
      '--primary-strong': '#89ddff',
      '--danger': '#f7768e',
      '--status': '#bb9af7',
      '--hover': 'rgba(122, 162, 247, 0.15)',
      '--selection': 'rgba(122, 162, 247, 0.3)',
      '--glass-bg': 'rgba(26, 27, 38, 0.8)',
      '--glass-border': 'rgba(65, 72, 104, 0.5)',
      '--shadow-subtle': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      '--shadow-strong': '0 10px 15px -3px rgba(0, 0, 0, 0.25)'
    })
  }
}
