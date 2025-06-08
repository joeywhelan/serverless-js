This article covers the deployment of an [Elastic Cloud Serverless](https://www.elastic.co/docs/deploy-manage/deploy/elastic-cloud/serverless) project and subsequent interaction with that project via the Elastic Javascript client.  A simple semantic search scenario is demonstrated.

This entire demo is done via application-level code (Javascript).  
  - [Serverless REST API](https://www.elastic.co/docs/api/doc/elastic-cloud-serverless/) is leveraged to create and delete a serverless project, from scratch
  - [Elastic Javascript client](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript) is instantiated and used to index and search a sample dataset

# Architecture #
This demo places minimal load on the client device as the entire architecture is cloud-based, split between Elastic and [Azure Openai](https://azure.microsoft.com/en-us/products/ai-services/openai-service).  The demo application (demo.js) makes a series of Elastic serverless REST API and Javascript client calls.

## High Level ##
![high-level architecture](assets/Highlevel-arch.jpg) 

## Application Level ##
![application-level architecture](assets/Applevel-arch.jpg)

# Functions #
Below is a step-by-step explanation of an end-to-end build of Elastic Serverless deployment using Javascript code, only.

## Create an Elastic Serverless Project ##
The function below will initiate the build of a serverless project via [REST API](https://www.elastic.co/docs/api/doc/elastic-cloud-serverless/operation/operation-createelasticsearchproject).  In this case, I've request a project that is optimized for vector operations.
### Code ###
```javascript
async function createProject(name, url, key) {
    const parms = {
        name: name,
        region_id:"aws-us-east-1",
        optimized_for:"vector"
    };

    let resp = await axios.post(url, parms, {
        headers: {
            'Authorization': `ApiKey ${key}`,
            'Content-Type': 'application/json'
        }
    });

    if (resp.status === 201) {
        console.log(resp.data);
        return resp.data;
    }
    else {
        throw new Error(resp.error);
    }
}
```
### Result ###
```json
{
  alias: 'demo-project-fb17e0',
  cloud_id: 'demo-project:dXMtZWFzdC0xLmF3cy5lbGFzdGljLmNsb3VkJGZiMTdlMDI2NmVhNjQ2NzFiZDdmYmMxOWQ4ZDg1N2M1LmVzJGZiMTdlMDI2NmVhNjQ2NzFiZDdmYmMxOWQ4ZDg1N2M1Lmti',
  id: 'fb17e0266ea64671bd7fbc19d8d857c5',
  metadata: {
    created_at: '2025-06-08T13:51:30.889055864Z',
    created_by: '3109974691',
    organization_id: '2698784787'
  },
  name: 'demo-project',
  region_id: 'aws-us-east-1',
  endpoints: {
    elasticsearch: 'https://demo-project-fb17e0.es.us-east-1.aws.elastic.cloud',
    kibana: 'https://demo-project-fb17e0.kb.us-east-1.aws.elastic.cloud'
  },
  optimized_for: 'vector',
  search_lake: { boost_window: 7, search_power: 100 },
  type: 'elasticsearch',
  credentials: { password: 'REDACTED', username: 'admin' }
}
```

## Wait For Build Completion ##
The function below awaits the completion of the cloud build that was kicked-off from the step above.  The [REST API](https://www.elastic.co/docs/api/doc/elastic-cloud-serverless/operation/operation-getelasticsearchprojectstatus) is used for this function.
### Code ###
```javascript
async function projectReady(id, url, key) {
    const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve,ms));

    const getProjectStatus = async () => {
        const resp = await axios.get(`${url}/${id}/status`, {
            headers: {
                'Authorization': `ApiKey ${key}`,
                'Content-Type': 'application/json'
            }
        });

        if (resp.status === 200) {
            return resp.data.phase;
        }
        else    {
            throw new Error(resp.error);
        }
    }
    
    let status = '';
    do {
        await sleep(5000);
        status = await getProjectStatus(id, url, key);
    } while (status !== 'initialized');
    console.log(status);
}
```
### Result ###
```text
initialized
```

## Create an Azure OpenAI Inference Endpoint ##
This function creates in inference endpoint to a pre-provisioned Azure Openai embedding resource.  This will allow automatic generation of embeddings during data ingestion and at query time.  The [Elastic Javascript client](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/api-reference#_inference.put) is used for this provisioning.
### Code ###
```javascript
async function createInferenceEP(client, inferenceId) {
    const response = await client.inference.put({
        task_type: "text_embedding",
        inference_id: inferenceId,
        inference_config: {
            service: "azureopenai",
                service_settings: {
                    api_key: process.env.AZURE_OPENAI_API_KEY,
                    resource_name: process.env.AZURE_OPENAI_RESOURCE_NAME,
                    deployment_id: process.env.AZURE_OPENAI_DEPLOYMENT_ID,
                    api_version: process.env.AZURE_OPENAI_API_VERSION,
                },
        },
    });
    console.log(response);
}
```
### Result ###
```json
{
  inference_id: 'azure_openai_embeddings',
  task_type: 'text_embedding',
  service: 'azureopenai',
  service_settings: {
    resource_name: 'joey-openai',
    deployment_id: 'text-embedding-ada-002',
    api_version: '2023-05-15',
    dimensions: 1536,
    similarity: 'dot_product',
    rate_limit: { requests_per_minute: 1440 }
  },
  chunking_settings: { strategy: 'sentence', max_chunk_size: 250, sentence_overlap: 1 }
}
```

## Create the Elasticsearch Index Mapping ##
Using the [Javascript client](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/api-reference#_indices.create), I build an index mapping (schema) for the sample dataset that is included in this repo.  It's a series of documents on with meta data on news articles.  It's important to note that I'm using [multi-fields](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/multi-fields) to create[semantic_text](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) fields that will automate the embedding generations utilizing the Azure OpenAI inference endpoint I created in the step above.
### Code ###
```javascript
async function createIndexMapping(client, indexName, inferenceId) {  
    const resp = await client.indices.create({
        index: indexName,
        mappings: {
            properties: {
                link: { type: 'text' },
                headline: {
                    type: 'text',
                    fields: {
                        semantic: {
                            type: 'semantic_text',
                            inference_id: inferenceId 
                        }
                    }
                },
                category: {
                    type: 'text',
                    fields: { keyword: { type: 'keyword' } }
                },
                short_description: {
                    type: 'text',
                    fields: {
                        semantic: {
                            type: 'semantic_text',
                            inference_id: inferenceId
                        }
                    }
                },
                authors: { type: 'text' },
                date: { type: 'date' }
            }
        }
    });
    console.log(resp);
}
```
### Result ###
```json
{ acknowledged: true, shards_acknowledged: true, index: 'articles' }
```

## Data Load ##
With the index mapping defined, I now do a bulk load of the JSON documents in the assets/articles.json file via the [Javascript client](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/client-helpers#bulk-helper).
### Code ###
```javascript
async function loadData(client, filePath, indexName) {
    const result = await client.helpers.bulk({
        datasource: fs.createReadStream(filePath).pipe(split2()),
        onDocument: () => {
            return {
                index: {_index: indexName}
            };
        }
    });
    console.log(`${result.successful} documents indexed`);
}
```
### Result ###
```text
1000 documents indexed
```

## Semantic Search ##
I next perform a semantic search with the [Javascript client](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/api-reference#_search) on the indexed 'articles' data set.  Note that the query embedding step is handled automatically.
### Code ###
```javascript
async function semanticSearch(client, indexName, text) {
    const res = await client.search({
        index: indexName,
        size: 1,
        query: {
            semantic: {
                field: 'short_description.semantic',
                query: text
            }
        }
    });
    console.log(res.hits.hits);
}
```
### Result ###
```json
[
  {
    _index: 'articles',
    _id: 'TUrRT5cBIGXfXs4VHrNy',
    _score: 0.9098367,
    _source: {
      link: 'https://www.huffpost.com/entry/punk-band-responds-oath-keeper-shirt_n_62ce22e1e4b0aa392d4598dd',
      headline: 'Punk Band Responds After Former Oath Keeper Wears Its Shirt At Jan. 6 Hearing',
      category: 'U.S. NEWS',
      short_description: 'The shirt featured "Milo," a cartoon on a number of album covers for the influential punk rock band The Descendents.',
      authors: 'Ben Blanchet',
      date: '2022-07-13'
    }
  }
]
```

## Project Deletion ##
Finally, I use the serverless [REST API](https://www.elastic.co/docs/api/doc/elastic-cloud-serverless/operation/operation-deleteelasticsearchproject) to delete this project.
### Code ###
```javascript
async function deleteProject(id) {
    let resp = await axios.delete(`${process.env.ELASTIC_API_URL}/${id}`, {
        headers: {
            'Authorization': `ApiKey ${process.env.ELASTIC_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (resp.status === 200) {
        console.log(resp.data);
    }
    else {
        throw new Error(resp.error);
    }
}
```
### Result ###
```text
Project deletion successful
```

# Source
https://github.com/joeywhelan/serverless-js