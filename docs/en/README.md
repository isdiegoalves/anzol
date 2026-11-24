# Documentation

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](README.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../README.md)

The map of the Anzol docs. Find the page by the task you want to get done, or by the kind of page. If a word does
not make sense, the [glossary](glossary.md) says what it is and what it is called in the API, in MCP and in the CLI.

**On this page:** [Where to start](#where-to-start) · [I want to…](#i-want-to) · [All pages](#all-pages)

## Where to start

1. [Quick start](../../README.md#quick-start): bring Anzol up with Docker and watch the first webhook arrive.
2. [What it does](../../README.md#what-it-does): each feature in one line, with the link to the detail.
3. [First round of the defense lab](defense-lab.md#first-round): measure what your script or agent blocks when the
   attack arrives signed.

## I want to…

| I want to… | Go to |
|---|---|
| See what my service sends | [Quick start](../../README.md#quick-start) |
| Choose what the URL answers | [Response rules](api.md#response-rules) |
| Make the URL fail a few times and then answer 200 | [Scenarios](api.md#scenarios) |
| Delay the response or drop the connection on purpose | [Delays and network failures](api.md#delays-and-network-failures) |
| Verify the provider's signature and see why it failed | [Signature verification](api.md#signature-verification) |
| Validate the body against a format | [Schema validation](api.md#schema-validation) |
| Open an attribute the sender encrypted | [Attribute decryption (E2EE)](api.md#attribute-decryption-e2ee) |
| Deliver what arrives at the URL to my local app | [`anzol listen`](cli.md#anzol-listen) |
| Fire a signed webhook at my app | [`anzol send`](cli.md#anzol-send) |
| Wait for a webhook in a test, with no `sleep` | [`anzol wait-for`](cli.md#anzol-wait-for), [`anzol test`](cli.md#anzol-test) or the [Waiting for messages](api.md#waiting-for-messages) route |
| Resend a recorded request to my app | [Replay and server-side send](api.md#replay-and-server-side-send) |
| Find one request among many | [Searching messages](api.md#searching-messages) |
| Protect reading the URL with a secret | [Read secret](privacy.md#read-secret) |
| Show a request to someone without exposing sensitive data | [Read-only links](privacy.md#read-only-links) |
| Connect an AI agent to Anzol | [MCP](mcp-and-ai.md#mcp) |
| Ask a local LLM for a rule in plain text | [Local AI](mcp-and-ai.md#local-ai) |
| Measure the defense of my script or agent | [Defense lab](defense-lab.md) |
| Turn on MCP, local AI, or publish the app | [Configuration](operations.md#configuration) |
| Know whether the server is up and on which version | [Health and version](operations.md#health-and-version) |
| Deploy to Kubernetes | [Helm](helm.md) |
| Run the tests and contribute | [Development](development.md) |
| Understand a word | [Glossary](glossary.md) |

## All pages

Each page is of one kind. A **first use** page takes you from zero to a result. A **how-to** solves one task. A
**reference** lists everything, to look things up. An **explanation** says why it is the way it is.

| Page | Kind | For whom | What is in it |
|---|---|---|---|
| [README](../../README.md) | First use | newcomers | what Anzol is, quick start, each feature in one line |
| [Defense lab](defense-lab.md) | First use and explanation | anyone receiving webhooks with a script or an AI agent | the first round, the 14 attacks, how to read the report, limits |
| [API](api.md) | Reference | integrators | every route, field, error and limit |
| [CLI](cli.md) | Reference | developers and testers | every `anzol` command, with options and examples |
| [MCP and local AI](mcp-and-ai.md) | How-to and reference | AI agent users | how to turn it on, the 23 tools, local AI and the risks |
| [Privacy and security](privacy.md) | Explanation | anyone keeping real data | who reads what, read secret, read-only links, protections |
| [Operations](operations.md) | How-to | whoever runs the server | variables, health, Redis memory, observability |
| [Helm](helm.md) | How-to | Kubernetes users | the chart and its values |
| [Development](development.md) | How-to | contributors | test suites, local CI, code standards |
| [Glossary](glossary.md) | Reference | everyone | each term, its name in the API and the name you may already know |

Outside this folder: the OpenAPI 3.1 document, served by the app at `/openapi.yaml` and `/openapi.json`, and the
black-box contract that guarantees the routes, in [`tests/contract/README.md`](../../tests/contract/README.md).
