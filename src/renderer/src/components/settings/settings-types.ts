import { AppSettings } from '../../core/types'

export interface VaultSettingsCallbacks {
  onVaultChange: () => Promise<void>
  onVaultReveal: () => Promise<void>
  onVaultSelected: (path: string) => Promise<void>
  onVaultLocated: (originalPath: string, newPath: string) => Promise<void>
}

export type SettingChangeHandler = (settings: Partial<AppSettings>) => void
