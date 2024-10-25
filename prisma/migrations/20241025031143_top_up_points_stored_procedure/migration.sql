CREATE OR REPLACE PROCEDURE top_up_points(epoch BIGINT, max_points BIGINT, user_ids TEXT[] DEFAULT ARRAY[]::TEXT[]) AS $$
BEGIN
    UPDATE "User"
    SET "ownPoints" = max_points,
        "epochUpdate" = epoch
    WHERE "key" = ANY(user_ids);
END;
$$ LANGUAGE plpgsql;