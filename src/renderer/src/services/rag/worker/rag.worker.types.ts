export interface RagWorkerJob {
  id: string
  type:
    | 'index'
    | 'search'
    | 'init'
    | 'delete'
    | 'embed'
    | 'add-feedback'
    | 'debug'
    | 'get-all-metadata'
    | 'switch-vault'
    | 'update-metadata'
  payload: any
}

export interface RagWorkerResponse {
  id: string
  success: boolean
  payload?: any
  error?: string
}
