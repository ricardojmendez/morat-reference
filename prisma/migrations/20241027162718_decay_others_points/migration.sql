CREATE OR REPLACE PROCEDURE decay_points(current_epoch BIGINT, user_ids TEXT[] DEFAULT ARRAY[]::TEXT[]) AS $$
DECLARE
    DECAY_RATE CONSTANT FLOAT := 0.1; -- Adjust the decay rate as needed
    point RECORD;
    new_points BIGINT;
BEGIN
    -- Loop through all points
    UPDATE "User"
        SET "othersPoints" = FLOOR("othersPoints" * (1 - DECAY_RATE))
        WHERE (user_ids IS NULL OR key = ANY(user_ids));
    FOR point IN
        SELECT * FROM "UserPoints"
        WHERE (user_ids IS NULL OR "ownerId" = ANY(user_ids))
    LOOP
        new_points := FLOOR(point.points * (1 - DECAY_RATE));
        IF new_points > 0 THEN
            -- Update points
            UPDATE "UserPoints"
            SET points = new_points, epoch = current_epoch
            WHERE id = point.id;
        ELSE
            -- Delete points with zero or less
            DELETE FROM "UserPoints"
            WHERE id = point.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;