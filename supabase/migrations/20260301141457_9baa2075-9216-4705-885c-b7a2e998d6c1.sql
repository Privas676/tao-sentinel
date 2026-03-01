
-- Push subscriptions table for Web Push notifications
CREATE TABLE public.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Allow anonymous subscriptions (no auth required) + authenticated users
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert push subscriptions"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read own push subscription by endpoint"
  ON public.push_subscriptions FOR SELECT
  USING (true);

CREATE POLICY "Anyone can delete own push subscription by endpoint"
  ON public.push_subscriptions FOR DELETE
  USING (true);

-- VAPID config table (single row, auto-generated keys)
CREATE TABLE public.push_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vapid_public_key text NOT NULL,
  vapid_private_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;

-- Public key is readable by anyone (needed for subscription)
CREATE POLICY "Anyone can read vapid public key"
  ON public.push_config FOR SELECT
  USING (true);
