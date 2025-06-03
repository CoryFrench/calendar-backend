-- Add property_city column to photobooking.bookings table if it doesn't exist
DO $$
BEGIN
    -- Check if the column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'photobooking' 
        AND table_name = 'bookings' 
        AND column_name = 'property_city'
    ) THEN
        -- Add the column if it doesn't exist
        ALTER TABLE photobooking.bookings 
        ADD COLUMN property_city VARCHAR(100);
        
        RAISE NOTICE 'Column property_city added to photobooking.bookings table';
    ELSE
        RAISE NOTICE 'Column property_city already exists in photobooking.bookings table';
    END IF;
END
$$; 