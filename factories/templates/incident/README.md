# incident template

Alerts arrive by signed webhook; the foreman and an SRE agent investigate and propose fixes. People deploy.

Create a factory from it with `kiln init --template incident`, edit `factory.yaml`, then `kiln validate .` and `kiln apply .`.
