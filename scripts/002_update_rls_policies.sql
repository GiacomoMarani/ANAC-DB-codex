-- Update RLS policies (public read only, insert/update for authenticated users)

-- Drop existing policy
DROP POLICY IF EXISTS "Allow public read access" ON cig;
DROP POLICY IF EXISTS "Allow public insert access" ON cig;
DROP POLICY IF EXISTS "Allow public update access" ON cig;
DROP POLICY IF EXISTS "Allow public delete access" ON cig;
DROP POLICY IF EXISTS "Allow authenticated insert access" ON cig;
DROP POLICY IF EXISTS "Allow authenticated update access" ON cig;

-- Create policy for public read access
CREATE POLICY "Allow public read access" ON cig
  FOR SELECT
  USING (true);

-- Create policy for authenticated insert access
CREATE POLICY "Allow authenticated insert access" ON cig
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create policy for authenticated update access
CREATE POLICY "Allow authenticated update access" ON cig
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
