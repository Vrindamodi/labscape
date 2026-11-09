-- Razorpay Subscriptions: two more lifecycle states and the provider's own status for support.
--   authenticated = mandate set up, first charge not yet confirmed (no Premium yet)
--   halted        = Razorpay stopped retrying a failed renewal (Premium off until a charge succeeds)
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('pending', 'authenticated', 'active', 'grace', 'halted', 'cancelled', 'expired'));
ALTER TABLE subscriptions ADD COLUMN provider_status text;
