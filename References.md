# References

## SourceCred

[SourceCred](https://sourcecred.io/docs/beta/cred/) has a good set of properties, including the fact that cred is alway flowing away from you (much like it makes no sense to hoard your own points in Morat).

Their focus is on contributions that could be easily gameable and, in the end, they wanted it to act as money, which is something I am actively trying to avoid.

## Circles

[Circles](https://joincircles.net/) is an alternative currency for basic income, which stopped operations on January 2024. It was meant as a currency, which is something Morat actively tries to avoid, and thus did not impose any rules on transfer or scoring. It's much closer to a blockchain-based fureai kippu than a reputation system.

## Matrix

The team behind Matrix had a post in 2020 about [a per-server reputation system](https://matrix.org/blog/2020/10/19/combating-abuse-in-matrix-without-backdoors/), where each server could then export their reputation feeds and others could decide on their own how to compose it.

I like the idea, and it is the closest I've found to what I am trying to accomplish with Morat. Reputation streams are likely the easiest way to use consider some reputation sources as positive and others as negative, and I intend to experiment with them in Morat.

## Intuition

[Intuition](https://www.intuition.systems/) bills itself as an "inter-agent semantics protocol".  It's one of the most interesting crypto-based projects I've encountered recently, and can be described as users assigning a score to arbitrary statements that are represented as composable [RDF triples](https://en.wikipedia.org/wiki/Resource_Description_Framework).

I have a few issues with it for a reputation system, though:

- It seems like the end result will be a global view popularity contest (even if the litepaper does briefly mention different interpretations of data);
- There isn't any decay, so a triple that had a high positive point assignment at some time in the past will have to receive a high negative point assignment to be negated;
- The fact that the litepaper states that everyone who has interacted with a statement gets a percentage of the points assigned to it in the future makes me think the mechanics are likely to result on users considering the points money.