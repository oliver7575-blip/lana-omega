export const INTEGRATION_TYPES = ['whatsapp', 'instagram', 'email', 'pms_cloudbeds'] as const
export type IntegrationType = (typeof INTEGRATION_TYPES)[number]

export interface IntegrationFieldDef {
  key: string
  label: string
  type: 'text' | 'password'
}

export interface IntegrationDef {
  type: IntegrationType
  label: string
  // Secret fields — encrypted before storage, never queryable in SQL.
  credentialFields: IntegrationFieldDef[]
  // Non-secret identifiers — stored in plain jsonb `config`, so they CAN be
  // queried directly (e.g. the inbound WhatsApp webhook looks up which
  // tenant owns a given phone_number_id by querying this field).
  configFields: IntegrationFieldDef[]
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    type: 'whatsapp',
    label: 'WhatsApp Business',
    credentialFields: [{ key: 'access_token', label: 'Access Token', type: 'password' }],
    configFields: [
      { key: 'phone_number_id', label: 'Phone Number ID', type: 'text' },
      { key: 'waba_id', label: 'WhatsApp Business Account ID', type: 'text' },
    ],
  },
  {
    type: 'instagram',
    label: 'Instagram',
    credentialFields: [{ key: 'access_token', label: 'Access Token', type: 'password' }],
    configFields: [{ key: 'page_id', label: 'Page ID', type: 'text' }],
  },
  {
    type: 'email',
    label: 'Email (SMTP)',
    credentialFields: [{ key: 'smtp_password', label: 'SMTP Password', type: 'password' }],
    configFields: [
      { key: 'smtp_host', label: 'SMTP Host', type: 'text' },
      { key: 'smtp_port', label: 'SMTP Port', type: 'text' },
      { key: 'smtp_user', label: 'SMTP Username', type: 'text' },
    ],
  },
  {
    type: 'pms_cloudbeds',
    label: 'Cloudbeds (PMS)',
    credentialFields: [{ key: 'api_key', label: 'API Key', type: 'password' }],
    configFields: [{ key: 'property_id', label: 'Property ID', type: 'text' }],
  },
]
