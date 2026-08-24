CREATE TABLE IF NOT EXISTS payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_code text NOT NULL UNIQUE,
  package_id text NOT NULL,
  package_name text NOT NULL,
  credits integer NOT NULL,
  amount_vnd integer NOT NULL,
  gateway text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  transaction_ref text,
  metadata jsonb DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_code ON payment_orders(order_code);
CREATE INDEX IF NOT EXISTS idx_orders_status ON payment_orders(status);
