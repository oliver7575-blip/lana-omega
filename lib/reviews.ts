import { createServiceClient } from './supabase/service'

export interface ReviewToolInput {
  reviewText: string
  sentiment: 'positive' | 'neutral' | 'negative'
  rating?: number
  ratingScale?: number
  summary?: string
}

export interface ReviewTool {
  recordReview(input: ReviewToolInput): Promise<{ saved: boolean; error?: string }>
}

/** Lets Lana file feedback a guest gives in a chat under Reviews, linked to the conversation. */
export function makeReviewTool(opts: {
  tenantId: string
  conversationId: string
  guestName: string | null
  source: 'whatsapp' | 'instagram' | 'widget'
}): ReviewTool {
  return {
    async recordReview(input) {
      const text = String(input.reviewText ?? '').trim()
      if (!text) return { saved: false, error: 'No review text' }
      const db = createServiceClient()
      // One review per conversation per day — later feedback updates it instead of duplicating.
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data: recent } = await db
        .from('reviews')
        .select('id, review_text')
        .eq('tenant_id', opts.tenantId)
        .eq('conversation_id', opts.conversationId)
        .gte('created_at', since)
        .maybeSingle()
      const values = {
        sentiment: ['positive', 'neutral', 'negative'].includes(input.sentiment) ? input.sentiment : 'neutral',
        rating: typeof input.rating === 'number' ? input.rating : null,
        rating_scale: typeof input.ratingScale === 'number' ? input.ratingScale : typeof input.rating === 'number' ? 5 : null,
        summary: input.summary?.slice(0, 400) ?? null,
      }
      const { error } = recent
        ? await db.from('reviews').update({ ...values, review_text: `${recent.review_text ?? ''}\n\n${text}`.trim().slice(0, 5000), status: 'new' }).eq('id', recent.id)
        : await db.from('reviews').insert({
            tenant_id: opts.tenantId,
            source: opts.source,
            platform: 'direct',
            guest_name: opts.guestName,
            review_text: text.slice(0, 5000),
            conversation_id: opts.conversationId,
            ...values,
          })
      return error ? { saved: false, error: error.message } : { saved: true }
    },
  }
}
