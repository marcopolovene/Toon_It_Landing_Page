-- ============================================================
-- process_play_payment RPC — Google Play Billing credit grant
-- Date: 2026-06-02
-- Mirrors process_stripe_payment, but de-dupes on the Play
-- purchase token (stored in credit_transactions.stripe_payment_id
-- with a 'play:' prefix so it never collides with Stripe cs_ ids
-- and reuses the existing idempotency lookup).
--
-- Parity notes vs Stripe handler:
--   * award_referral_purchase_bonus is DEPRECATED (no-op) -> omitted.
--   * clear_free_credit_expiry is called by the n8n handler
--     separately (same as Stripe), so it is NOT embedded here.
--
-- SECURITY: SECURITY DEFINER. Only the n8n verification endpoint
-- (service-role key, AFTER verifying the purchase token against the
-- Google Play Developer API) should call this. Never call it from
-- the client.
--
-- Reversible: DROP FUNCTION public.process_play_payment(uuid,integer,text);
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_play_payment(
    p_user_id uuid,
    p_credits integer,
    p_purchase_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_ref text;
    v_exists boolean;
BEGIN
    -- Guard rails (mirror Stripe validation bounds)
    IF p_user_id IS NULL OR p_purchase_token IS NULL OR length(p_purchase_token) < 8 THEN
        RAISE EXCEPTION 'PLAY_PAYMENT_INVALID: missing user_id or purchase_token';
    END IF;
    IF p_credits IS NULL OR p_credits <= 0 OR p_credits > 100 THEN
        RAISE EXCEPTION 'PLAY_PAYMENT_INVALID: credits out of range';
    END IF;

    -- Namespaced reference so Play tokens never collide with Stripe cs_ ids
    v_ref := 'play:' || p_purchase_token;

    -- Idempotency: has this purchase token already granted credits?
    SELECT EXISTS(
        SELECT 1 FROM credit_transactions
        WHERE stripe_payment_id = v_ref
    ) INTO v_exists;

    IF v_exists THEN
        -- Already processed (e.g. acknowledge retry) -> skip, do not double-grant
        RETURN false;
    END IF;

    -- Grant credits
    UPDATE profiles
    SET credits = credits + p_credits,
        total_credits_purchased = total_credits_purchased + p_credits,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Log transaction (reuses stripe_payment_id column as the generic provider ref)
    INSERT INTO credit_transactions (user_id, amount, type, description, stripe_payment_id)
    VALUES (p_user_id, p_credits, 'purchase', 'Google Play purchase', v_ref);

    RETURN true;
END;
$function$;
