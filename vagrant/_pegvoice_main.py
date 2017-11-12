from natlinkutils import GrammarBase
import requests


class CatchAll(GrammarBase):

    # this spec will catch everything
    gramSpec = """
        <start> exported = {emptyList};
    """

    def initialize(self):
        self.load(self.gramSpec, allResults=1)
        self.activateAll()

    def gotResultsObject(self, recogType, resObj):
        interpretations = []
        for x in range(0, 100):
            try:
                interpretations.append([
                    word.decode('windows-1252')
                    for word in resObj.getWords(x)
                ])
            except Exception as e:
                print('err: %s' % e)
                break

        requests.post(
            'http://10.0.128.1:9099/dragon',
            json={
                'interpretations': interpretations,
            },
        )

c = CatchAll()
c.initialize()


def unload():
    global c
    if c:
        c.unload()
    c = None
