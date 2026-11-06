class RevisionConflict(Exception):
    def __init__(self, revision: int, updated_at):
        super().__init__("revision_conflict")
        self.revision = revision
        self.updated_at = updated_at
