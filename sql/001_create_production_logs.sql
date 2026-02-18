-- ============================================================
-- 농림부 실적 보고용 production_logs 테이블
-- IoT 스마트 저울에서 올라온 생산 실적을 저장합니다.
-- ============================================================

CREATE TABLE IF NOT EXISTS production_logs (
  id              SERIAL        PRIMARY KEY,
  production_date DATE          NOT NULL,                           -- 생산일자
  traceability_no VARCHAR(15)   NOT NULL,                           -- 이력번호 (13자리 + 여유)
  product_name    VARCHAR(50)   NOT NULL,                           -- 품목명 (한우, 돼지, 닭 등)
  part_name       VARCHAR(50)   NOT NULL,                           -- 부위명 (등심, 안심, 목심 등)
  production_weight NUMERIC(10,2) NOT NULL CHECK (production_weight > 0), -- 생산중량(kg)
  report_status   VARCHAR(20)   NOT NULL DEFAULT 'PENDING',         -- 보고상태 (PENDING | REPORTED | REJECTED)
  note            TEXT          DEFAULT '',                          -- 비고
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 월별 조회 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_production_logs_date
  ON production_logs (production_date);

-- 이력번호 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_production_logs_traceability
  ON production_logs (traceability_no);

-- report_status 필터용 인덱스
CREATE INDEX IF NOT EXISTS idx_production_logs_status
  ON production_logs (report_status);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_production_logs_updated_at
  BEFORE UPDATE ON production_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
