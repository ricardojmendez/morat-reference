CREATE OR REPLACE FUNCTION tally_assigned_points(owner_id TEXT)
RETURNS BIGINT AS $$
DECLARE
    total_points BIGINT;
    user_others_points BIGINT;
BEGIN
    -- Calculate the sum of points from the UserPoints table
    SELECT COALESCE(SUM(points), 0)
    INTO total_points
    FROM "UserPoints"
    WHERE "ownerId" = owner_id;

    -- Get the othersPoints from the User table
    SELECT COALESCE("othersPoints", 0)
    INTO user_others_points
    FROM "User"
    WHERE "key" = owner_id;

    -- Return the total points
    RETURN total_points + user_others_points;
END;
$$ LANGUAGE plpgsql;