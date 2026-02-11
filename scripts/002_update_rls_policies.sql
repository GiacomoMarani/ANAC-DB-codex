-- Update RLS policies to allow insert, update, and delete operations

-- Drop existing policy
DROP POLICY IF EXISTS "Allow public read access" ON cig;

-- Create policy for public read access
CREATE POLICY "Allow public read access" ON cig
  FOR SELECT
  USING (true);

-- Create policy for public insert access
CREATE POLICY "Allow public insert access" ON cig
  FOR INSERT
  WITH CHECK (true);

-- Create policy for public update access  
CREATE POLICY "Allow public update access" ON cig
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Create policy for public delete access
CREATE POLICY "Allow public delete access" ON cig
  FOR DELETE
  USING (true);
