# graphql-rascal-subscriptions

This package implements the PubSubEngine interface from the graphql-subscriptions package. It allows you to connect your subscriptions manager to RabbitMQ. The package aims to give you full control of the exchanges, queues, subscriptions, and bindings that would come to find with a low-level RabbitMQ client. This is why we decided to choose Rascal as our RabbitMQ client. It offers ease of configuration without sacrificing functionality. ES6 and Promises are also first class citizens, which was viewed as a priority when creating this package.

The package takes inspiration from both [graphql-rabbitmq-subscriptions](https://github.com/cdmbase/graphql-rabbitmq-subscriptions) and [graphql-redis-subscriptions](https://github.com/davidyaha/graphql-redis-subscriptions).

## Currently WIP

This package is VERY much a work in progress still. There are many things that are either unfinished/unsupported. As we approach a version 1.0.0, please expect many breaking changes. Once 1.0.0 is release the package will be considered stable and breaking changes will be announced very much in advance.

Expect the README to be updated fequently has we approach version 1.0.0

### Tasks

- [X] Implement PubSubEngine
- [ ] Implement AsyncIterator
- [ ] Tests, Tests, Tests
- [ ] Add graphql-module usage to README
- [ ] Add subscription manager usage to README
- [X] Add installation to README
- [ ] Add configuration usage to README
- [X] First publish to NPM

## Installation

Start by installing the `graphql-rascal-subscriptions` package

```
npm i graphql-rascal-subscriptions
```

Since [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions) is declared as a peer dependency, you may also need to install it as well. This is only if you see a warning for the unmet peer dependency

```
npm i graphql-subscriptions
```

## Contributing

If you would like to contribute please feel free to submit a merge request. Please reach out to me with any suggestions or possible enhancements, all suggestions are welcomed!
