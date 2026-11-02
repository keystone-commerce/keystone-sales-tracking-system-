CREATE TABLE login_otp_challenges (
 id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),email text NOT NULL,code_hash text NOT NULL,
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 delivery_status text NOT NULL CHECK(delivery_status IN ('pending','sent','failed')),consumed_at timestamptz
);
CREATE INDEX login_otp_email_created ON login_otp_challenges(email,created_at DESC);
CREATE TABLE login_otp_limits (
 key text PRIMARY KEY,window_started_at timestamptz NOT NULL,attempts integer NOT NULL CHECK(attempts>0)
);
