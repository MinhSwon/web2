CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value)
VALUES ('bank_config', '{"bank_id": "MB", "bank_name": "MB Bank (Ngân Hàng Quân Đội)", "account_no": "999988886666", "account_name": "FRAME FOUNDRY AI"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
