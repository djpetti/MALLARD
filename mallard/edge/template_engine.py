"""
Global state for the template engine.
"""


from jinja2 import Environment, PackageLoader, select_autoescape

template_environment = Environment(
    loader=PackageLoader("mallard.edge"),
    autoescape=select_autoescape(["html", "xml"]),
    enable_async=True,
)
