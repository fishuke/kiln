# kiln-self

The factory that builds Kiln (dogfooding, PLAN.md milestone 3 onward). Apply it with `kiln apply factories/kiln-self`, then label issues in fishuke/klin `kiln-ready`.

The policies make the factory unable to weaken the checks that review it: it cannot edit the validator, auth, policies or gate logic, and changes there need two people.
