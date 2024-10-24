# Performance considerations

## v0.3.0 (WIP)

The average processing time for point assignments on a MacBook Pro M2 with 32GB of RAM is currently between 25ms-45m, after some index, memory, and checkpointing tweaks, when processing point assign intents on batches of 100.  

Some options follow.

## Keeping only the top N contributors after one epoch

Some of the accounts have over 8k individual point assignments that have spread through the network, which makes retrieving and propagating them in turn slower.

I've gone into the data explosion issue on the [Design and Implementation document](Design-And-Implementation.md), and keeping only the top N contributors after an epoch will likely significantly improve average performance. 

### In-memory changes

I could apply all point assignments in memory, and only update the database once I've processed a batch. That will make it faster to update when we have a lot of point assignments for a single account.

Then again, that would move us closer and closer to checkpointing - consider if we may just want to use something like Valkey with periodic checkpoints to disk.

(Also, on an initial review it doesn't seem like we often get repeated owners when looking at a batch of 100-200 assignments)

### Document databases

Using a document database would make it harder to run some queries - it'd be trivial to get UserA's points, but much harder to collect who they have assigned points to - however it may be a small price to pay.

Some things a k-v system would make harder:

- Query the last N point assign intent awaiting to be processed
- Get the users whose points we have yet to decay on this iteration
- Get the set of unclaimed points that need to be expired altogether

### Moving things to stored procedures

If we do want to stay fully relational, maybe we don't need to retrieve the records, and just commit and rewrite all the point assignment as PL/SQL stored procedures.  Old school.

That would mean I don't need to retrieve them.

But even then, just the query to look up and lock the points from postgres itself can take about 8ms for a user with 4k point records.  That would be stored procedure speed.  Let's say we cut it significantly by only keeping the top 1k points. It may end up dropping to 2-3ms.

So it seems to be about if we want to rewrite this whole thing in PL/SQL, with the main trade-off being that it would sacrifice horizontal scaling, since every point update calculations would hit the database.

Having said that, per-epoch point decay *might* be better done as a stored procedure regardless, as well as user point tally (done as a check to verify the user has enough points to transfer).


### Current state

Then again, this seems to be a somewhat premature optimization and mostly relevant if we want to process a massive number of events, like the entire *like* event firehose from BlueSky.  For smaller datasets, like the network of a subset of users, this will do.

It seems that in the near future, it is more important to change the ATProto feeder so that it:

- Allows us to indicate which accounts we care to track reputation for;
- Keep up to date with their network, up to a 2nd degree;
- Track reputation for those individuals in our circle of interest as events come in.