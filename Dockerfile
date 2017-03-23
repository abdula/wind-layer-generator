FROM node:boron

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install Python.
RUN \
  apt-get update && \
  apt-get install -y python python-dev build-essential python-pip python-virtualenv python-gdal python-tk && \
  rm -rf /var/lib/apt/lists/*

  
RUN \  
  python -m pip install --upgrade pip && \
  pip install --upgrade pip && \
  pip install numpy scipy matplotlib ipython jupyter pandas sympy nose GDAL
  
  
COPY package.json /usr/src/app/
RUN npm install

# Bundle app source
COPY . /usr/src/app

CMD [ "npm", "start"]  